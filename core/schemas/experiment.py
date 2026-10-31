# =============================================================================
# core.schemas.experiment — experiment configuration, states, preflight
# =============================================================================
# HOW it fits in the pipeline:
#   ExperimentCreate (user/API/CLI) ──preflight──▶ controller ──▶ state machine
#
# WHY hard caps live HERE as module constants + validators:
#   The safety model requires caps enforced in THREE places (Pydantic → runner
#   → k6 options). This is layer 1. The runner re-checks against server config
#   (layer 2, in case someone constructs LoadConfig in Python bypassing the
#   API) and the generated k6 script encodes them (layer 3, in case the
#   process is tampered with between spawn and run). A bypass in one layer is
#   caught by the next.
#
# WHY caps are module constants and not read-from-env here:
#   Schemas must be importable with zero config (tests, CLI --help, docs).
#   Server env (MAX_RPS etc.) is applied in backend/app/config.py, which
#   RE-VALIDATES against these caps and may only make them stricter, never
#   looser. The constants are the absolute ceiling.
# =============================================================================

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, model_validator

# --- absolute hard caps (server may only tighten these, never loosen) ---------
CAP_MAX_RPS = 500
CAP_MAX_VUS = 200
CAP_MAX_DURATION_S = 300
CAP_MAX_TOTAL_REQUESTS = 100_000
CAP_MAX_TIMEOUT_S = 10.0


class ExperimentType(str, Enum):
    """What kind of question the experiment answers.

    FAULT_UNDER_LOAD is P2: it changes TWO variables at once, so results are
    confounded. The report generator refuses causal statements for it unless
    a controlled single-variable comparison exists in history."""

    CAPACITY = "capacity"            # ramp load, no fault
    FAULT = "fault"                  # constant load, inject fault
    FAULT_UNDER_LOAD = "fault_under_load"  # both — confounded, P2


class ExperimentState(str, Enum):
    """Lifecycle states. Terminal states: COMPLETED, PREFLIGHT_FAILED,
    ABORTED, AUTO_STOPPED, FAILED. The SSE stream emits a `state` message on
    every transition; the frontend pill maps 1:1 to these values."""

    PENDING = "pending"
    PREFLIGHT_FAILED = "preflight_failed"
    RUNNING = "running"
    COMPLETED = "completed"
    ABORTED = "aborted"            # user kill switch
    AUTO_STOPPED = "auto_stopped"  # safety threshold tripped
    FAILED = "failed"              # internal error (not the app's fault)


class Phase(str, Enum):
    """Experiment phases. Every MetricBucket is tagged with the phase active
    when its second started — that tag is how phase stats are computed later.
    A phase boundary is a timestamp in phase_markers; buckets straddling a
    boundary keep the phase they STARTED in (simpler, and a 1s skew is within
    our noise budget)."""

    BASELINE = "baseline"    # constant load, no fault — the control group
    FAULT = "fault"          # fault active
    RECOVERY = "recovery"    # fault restored, waiting for SLOs to hold
    LOAD_STEP = "load_step"  # one multiplier window in a capacity run


class SLO(BaseModel):
    """Service Level Objectives — the definition of "healthy" for this run.
    Everything downstream (breach detection, recovery measurement, exit
    codes) is defined relative to THESE numbers, so they are part of the
    immutable experiment config."""

    p95_ms: float = Field(300, gt=0, le=60_000)
    max_error_rate: float = Field(0.01, ge=0, le=1)
    # Achieved RPS must be ≥ this fraction of target RPS. Catches a generator
    # that can't keep up OR an app so slow it back-pressures the open-model
    # executor (rare with arrival-rate, but cheap to check).
    min_rps_ratio: float = Field(0.95, gt=0, le=1)


class SafetyLimits(BaseModel):
    """Auto-stop thresholds — DISTINCT from SLOs. SLOs define success;
    safety limits define "stop hammering, the target is hurting".
    A run can breach SLOs and keep going (that's the measurement);
    it must NOT breach safety limits (that's damage)."""

    # NOTE: lt=1, not le=1. The abort rule is `error_rate > max_error_rate`
    # held for N seconds — a limit of 1.0 would require exceeding 100% errors,
    # which is impossible, so the safety net would silently never fire.
    # Rejecting 1.0 catches that misconfiguration at validation time.
    max_error_rate: float = Field(0.5, gt=0, lt=1)   # 50% default — target is effectively down
    max_p95_ms: float = Field(5_000, gt=0, le=60_000)
    # Thresholds must hold for this many consecutive seconds before we abort —
    # avoids killing a run on a single noisy bucket.
    consecutive_seconds: int = Field(5, ge=1, le=60)


class LoadConfig(BaseModel):
    """Load shape for an experiment. For FAULT experiments multipliers must be
    exactly one entry (constant load — the controlled variable is the fault,
    not the traffic). For CAPACITY experiments it's the ramp ladder."""

    target_base_url: HttpUrl
    # Paths only, GET only. No scheme, no host — validated below.
    # Max 10 endpoints: keeps the k6 request mix readable in the UI preview.
    endpoints: list[str] = Field(min_length=1, max_length=10)
    baseline_rps: int = Field(20, ge=1, le=CAP_MAX_RPS)
    # Ascending multipliers, e.g. [1, 2, 5, 10]. Ascending because breach
    # detection assumes we walk UP the ladder and stop reasoning after the
    # first breach.
    multipliers: list[float] = Field(default_factory=lambda: [1.0], min_length=1, max_length=8)
    step_duration_s: int = Field(20, ge=5, le=120)
    ramp_s: int = Field(5, ge=0, le=30)  # linear ramp between steps
    max_vus: int = Field(100, ge=1, le=CAP_MAX_VUS)
    request_timeout_s: float = Field(5, gt=0, le=CAP_MAX_TIMEOUT_S)

    @model_validator(mode="after")
    def check_caps(self) -> LoadConfig:
        """Layer-1 hard-cap enforcement. WHY in the schema: the CLI, the API,
        and any future caller all hit this validator — there is no path to a
        LoadConfig that violates caps without deliberately bypassing Pydantic
        (at which point layer-2 in the runner catches it)."""
        if any(m <= 0 for m in self.multipliers):
            raise ValueError("multipliers must be positive")
        if list(self.multipliers) != sorted(self.multipliers):
            raise ValueError("multipliers must be ascending")
        if max(self.multipliers) * self.baseline_rps > CAP_MAX_RPS:
            raise ValueError(
                f"peak RPS {max(self.multipliers) * self.baseline_rps} exceeds "
                f"hard cap of {CAP_MAX_RPS}"
            )
        # Total wall time: one (step + ramp) per multiplier. The 300s cap
        # exists so a runaway config can't hold the global experiment lock
        # (one-at-a-time) for an unreasonable time.
        total = len(self.multipliers) * (self.step_duration_s + self.ramp_s)
        if total > CAP_MAX_DURATION_S:
            raise ValueError(
                f"total duration {total}s exceeds hard cap of {CAP_MAX_DURATION_S}s"
            )
        for p in self.endpoints:
            # Endpoints are PATHS. Rejecting "://" here stops a user from
            # smuggling a second host past target_base_url allowlisting.
            if not p.startswith("/") or "://" in p:
                raise ValueError(f"endpoint '{p}' must be a path like /api/x")
        return self

    @property
    def total_duration_s(self) -> int:
        """Used by the controller to compute k6 stage durations and by the
        safety watchdog's elapsed-time check."""
        return len(self.multipliers) * (self.step_duration_s + self.ramp_s)


class FaultKind(str, Enum):
    """Fault mechanisms. Only STOP_CONTAINER is P1; the rest are P2 and may
    be unimplemented — the enum exists so configs are forward-compatible."""

    STOP_CONTAINER = "stop_container"
    PAUSE_CONTAINER = "pause_container"   # P2
    STOP_API_REPLICA = "stop_api_replica"  # P2
    LATENCY = "latency"                   # P2, via toxiproxy
    ERROR_INJECTION = "error_injection"   # P2, via demo-app chaos endpoint


class FaultConfig(BaseModel):
    """A fault experiment's fault definition + phase timing.

    WHY phase durations are config, not constants: the demo wants 20s phases;
    CI wants 5s; a user with a slow-reconnecting client may want 60s
    baseline. Making them config keeps the controller generic."""

    kind: FaultKind
    # Service NAME (must also pass allowlist + label checks at preflight).
    # Pattern restricts to Docker-safe names — stops path traversal / injection
    # into docker CLI invocations (we use the SDK, but validate anyway).
    target_service: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$")
    baseline_s: int = Field(20, ge=5, le=120)
    fault_s: int = Field(20, ge=5, le=120)
    # If SLOs don't hold this long after restore, report "not recovered".
    # Separate from fault_s: recovery can legitimately take longer than the
    # fault itself (e.g. cache warm-up).
    recovery_timeout_s: int = Field(60, ge=10, le=180)
    # SLOs must hold for N consecutive seconds to count as recovered.
    # 5s filters out single-good-bucket noise.
    recovery_stable_s: int = Field(5, ge=1, le=30)
    # Only meaningful for LATENCY faults.
    latency_ms: int | None = Field(None, ge=1, le=5_000)

    @model_validator(mode="after")
    def _latency_needs_ms(self) -> FaultConfig:
        if self.kind == FaultKind.LATENCY and self.latency_ms is None:
            raise ValueError("latency_ms is required when kind='latency'")
        return self


class ExperimentCreate(BaseModel):
    """The full user-supplied experiment definition. IMMUTABLE once the run
    starts (stored as-is in experiments.config) so a report always describes
    exactly what was asked for, not what someone edited later."""

    name: str = Field(min_length=1, max_length=120)
    type: ExperimentType
    # Optional link to a stored graph — used to resolve service names and to
    # attach verified edges back to the right graph after the run.
    graph_id: UUID | None = None
    load: LoadConfig
    # Required for FAULT/FAULT_UNDER_LOAD, forbidden for CAPACITY — enforced
    # below. WHY bidirectional: a "capacity" run that secretly injects a
    # fault would produce confounded results while claiming to be controlled.
    fault: FaultConfig | None = None
    slo: SLO = Field(default_factory=SLO)
    safety: SafetyLimits = Field(default_factory=SafetyLimits)

    @model_validator(mode="after")
    def fault_matches_type(self) -> ExperimentCreate:
        needs_fault = self.type in (ExperimentType.FAULT, ExperimentType.FAULT_UNDER_LOAD)
        if needs_fault and self.fault is None:
            raise ValueError(
                f"experiment type '{self.type.value}' requires a fault config"
            )
        if not needs_fault and self.fault is not None:
            raise ValueError("capacity experiments must not include a fault")
        if self.type == ExperimentType.FAULT and len(self.load.multipliers) != 1:
            # WHY: a fault experiment with a load ramp changes two variables.
            # Users who want that must opt into fault_under_load explicitly so
            # the report can flag the run as confounded.
            raise ValueError(
                "fault experiments use a single constant load level "
                "(use fault_under_load to vary both, explicitly labelled)"
            )
        if needs_fault and self.fault is not None:
            # Load must COVER the whole fault timeline: recovery is measured
            # from post-restore REQUEST buckets, so if k6 stops before
            # baseline+fault+recovery elapses, "not recovered" would be an
            # artifact of our own config, not the app. Checked here (create
            # time, with a fixable message) rather than surfacing as a
            # confusing recovery failure an hour later.
            timeline = (
                self.fault.baseline_s + self.fault.fault_s + self.fault.recovery_timeout_s
            )
            if self.load.total_duration_s < timeline:
                raise ValueError(
                    f"load duration {self.load.total_duration_s}s is shorter than the "
                    f"fault timeline (baseline {self.fault.baseline_s}s + fault "
                    f"{self.fault.fault_s}s + recovery {self.fault.recovery_timeout_s}s "
                    f"= {timeline}s); increase step_duration_s so load covers all phases"
                )
        return self


class PreflightCheck(BaseModel):
    """One row in the preflight checklist UI. `id` is a stable string the
    frontend maps to icons/copy — do not rename without coordinating."""

    id: str           # e.g. "env-label", "fault-allowlist", "production-guard"
    label: str        # human sentence shown next to the checkbox
    passed: bool
    detail: str       # why it passed/failed — always populated, even on pass


class PreflightResult(BaseModel):
    """Returned by POST /experiments and re-runnable via
    POST /experiments/{id}/preflight. We return EVERY failed check, not just
    the first, so a user fixes all blockers in one pass."""

    passed: bool
    checks: list[PreflightCheck]

    @model_validator(mode="after")
    def _passed_matches_checks(self) -> PreflightResult:
        # Integrity check: `passed` must equal AND(checks.passed). A mismatch
        # is a controller bug — catching it here prevents the UI from showing
        # a green checklist on a failed preflight.
        actual = all(c.passed for c in self.checks) if self.checks else False
        if self.passed != actual:
            raise ValueError("preflight.passed does not match the checks list")
        return self


class ExperimentCreated(BaseModel):
    """Response to POST /experiments — just the id + state, because the
    caller (UI or CLI) will immediately GET or stream for details. Keeps the
    create endpoint cheap."""

    id: UUID
    state: ExperimentState
    preflight: PreflightResult
