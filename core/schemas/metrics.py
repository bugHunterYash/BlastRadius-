# =============================================================================
# core.schemas.metrics — live buckets, phase stats, evidence
# =============================================================================
# HOW it fits in the pipeline:
#   k6 JSON stream ──collector──▶ MetricBucket (1s, in-memory → DB)
#                                        │
#                          analysis re-reads RAW samples
#                                        ▼
#                              PhaseStats (exact percentiles)
#                                        │
#                          evidence rules (3σ, thresholds)
#                                        ▼
#                                    Evidence
#
# WHY OptionalMetric exists instead of `float | None`:
#   `None` is ambiguous — is the value zero, missing, or low-confidence?
#   OptionalMetric forces every absent value to carry a `status` + `reason`
#   ("unavailable: docker socket not mounted"). The UI renders
#   "Not available: <reason>" instead of a fake 0. This is the honesty
#   principle at the type level — zero-filling would require going OUT of your
#   way to violate it.
#
# WHY percentiles are recomputed from raw samples for PhaseStats:
#   Averaging 1s-bucket p95s does NOT give the true p95 of the phase
#   (percentiles are not linear). PhaseStats.percentiles must be computed by
#   sorting the phase's raw durations. Bucket p95s exist ONLY for the live
#   chart, where per-second approximation is fine and the alternative (buffer
#   everything until phase end) would make the chart useless mid-run.
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class RawSample:
    """One measured request, as consumed from the k6 JSON Point stream.

    Deliberately a plain (frozen) dataclass, NOT a Pydantic model: the
    collector instantiates this once per request — up to 100k times per run —
    and Pydantic validation overhead × 100k is measurable. Schemas that are
    BOUNDARY objects (config, API payloads, stored rows) stay Pydantic;
    hot-path internal records stay dataclasses.

    t: elapsed seconds since experiment start (float — sub-second precision
       matters for window filtering; MetricBucket.elapsed_s is floor-aligned
       to its second, this is not).
    status: HTTP status code; 0 = transport-level failure (timeout, conn
       refused) — k6 reports these as `http_req_failed` with no usable status.
    """

    t: float
    duration_ms: float
    endpoint: str
    status: int = 0
    error: str = ""            # k6 error tag when the request failed


@dataclass(frozen=True)
class Percentiles:
    """Exact percentiles computed by sorting a phase's raw durations.

    p99 carries a trust flag instead of being a bare float: at low sample
    counts p99 is noise, and the schema's OptionalMetric (status LOW_SAMPLE)
    is how that reaches the UI. n is the sample count backing ALL of these."""

    p50_ms: float | None
    p95_ms: float | None
    p99_ms: float | None
    max_ms: float | None
    n: int
    p99_trusted: bool = True   # False when n < 100 (see MetricBucket.p99_ms)

    @classmethod
    def empty(cls) -> Percentiles:
        return cls(p50_ms=None, p95_ms=None, p99_ms=None, max_ms=None, n=0, p99_trusted=False)


class MetricStatus(str, Enum):
    OK = "ok"
    UNAVAILABLE = "unavailable"  # source missing — reason required
    LOW_SAMPLE = "low_sample"    # value computed but too few samples to trust


class OptionalMetric(BaseModel):
    """A metric that might not exist. WHY not just None: the UI needs to say
    WHY it's missing, and the report's `missing_metrics` list is built from
    these reasons. A bare None would render as an empty cell and look like
    we forgot to measure."""

    value: float | None
    status: MetricStatus
    # Required whenever status != OK. Pydantic can't express conditional
    # required-ness cleanly, so the model_validator below enforces it.
    reason: str | None = None

    def model_post_init(self, __context: object) -> None:
        if self.status != MetricStatus.OK and not self.reason:
            raise ValueError("reason is required when status is not 'ok'")


class MetricBucket(BaseModel):
    """One second of aggregated measurements. The atomic unit of the live
    chart AND the `metric_buckets` table (JSONB, PK = (experiment_id, t)).

    Naming note: fields use short names (p95_ms, rps) because this object is
    serialized ~once per second over SSE — every character costs bandwidth
    on a 5-minute run (300 messages × N dashboard tabs)."""

    t: datetime                 # bucket start (floor to second)
    elapsed_s: float            # seconds since experiment start — x-axis
    phase: str                  # Phase value active when this bucket STARTED
    load_multiplier: float      # 1.0, 2.0, ... — capacity runs tag every bucket
    target_rps: float           # what k6 was asked for — vs achieved rps below

    requests: int = 0
    successes: int = 0          # 2xx
    failures: int = 0           # non-2xx + timeouts + connection errors (total)
    timeouts: int = 0           # subset of failures — shown separately in UI
    rps: float = 0              # achieved requests/second in this bucket
    error_rate: float = 0       # failures / requests (0 when requests == 0)

    # Latency percentiles for THIS second, computed from that second's raw
    # durations. None when the bucket had no completed requests.
    p50_ms: float | None = None
    p95_ms: float | None = None
    max_ms: float | None = None
    # p99 is OptionalMetric because a 1s bucket at 20 RPS has ~20 samples —
    # a p99 from 20 samples is meaningless. LOW_SAMPLE below 100 samples.
    p99_ms: OptionalMetric = Field(default_factory=lambda: OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE, reason="no samples"))

    # Per-container resource usage — only populated when the docker stats
    # sampler is running (P2-lite). Keyed by service name.
    cpu_pct: dict[str, OptionalMetric] = Field(default_factory=dict)
    mem_pct: dict[str, OptionalMetric] = Field(default_factory=dict)
    # DB active connections vs max — requires DEMO_DB_URL to be configured.
    db_connections: OptionalMetric = Field(default_factory=lambda: OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE, reason="DEMO_DB_URL not configured"))
    # Per-service health from /health probes: healthy | unhealthy | unknown.
    health: dict[str, Literal["healthy", "unhealthy", "unknown"]] = Field(default_factory=dict)


class PhaseStats(BaseModel):
    """Aggregated stats for one phase (or one load step). Served by
    GET /experiments/{id} alongside the config, and embedded in the Report.

    WHY percentiles here are plain floats (not OptionalMetric): by the time
    we're computing phase stats we have the raw file; if a phase has zero
    samples that's a run-level failure, already surfaced as state=FAILED.
    Keeping these as plain floats makes the report template simpler."""

    phase: str
    load_multiplier: float
    start: datetime
    end: datetime
    requests: int
    error_rate: float
    rps: float
    p50_ms: float | None
    p95_ms: float | None
    p99_ms: OptionalMetric  # still optional — phase can be short
    max_ms: float | None
    # Which SLOs this phase violated. Empty list = healthy. Capacity runs use
    # this to find the first breach; fault runs use it to show the delta vs
    # baseline.
    slo_breaches: list[Literal["p95", "error_rate", "throughput"]] = Field(default_factory=list)


class EvidenceKind(str, Enum):
    """How we know a service was impacted. Each kind has a deterministic
    rule in core/analysis/evidence.py — no fuzzy matching, no LLM."""

    REQUEST_ERRORS = "request_errors"        # error rate spike outside noise
    LATENCY_REGRESSION = "latency_regression"  # p95 rose ≥50% AND ≥50ms
    HEALTH_CHECK = "health_check"            # /health flipped to unhealthy
    LOG_SIGNATURE = "log_signature"          # P2 — error regex in logs


class Evidence(BaseModel):
    """One measurement proving a service was impacted during the fault.
    Stored in the `evidence` table; rendered in the live feed and the report.

    WHY every field is explicit (baseline_value, observed_value, window,
    sample_count): this is the audit trail. If we claim "demo-api error rate
    went 0.2% → 94%", the user must be able to click through and see the
    numbers, the time window, and n=412. Without that, 'verified' is just a
    prettier word for 'assumed'."""

    service: str
    kind: EvidenceKind
    metric: str                    # e.g. "error_rate:/api/cart", "p95_ms"
    baseline_value: float | None   # mean during BASELINE phase
    observed_value: float | None   # max/mean during FAULT window
    window_start: datetime
    window_end: datetime
    sample_count: int              # requests in the fault window — small n = weak evidence
    detail: str                    # human sentence, e.g. "error rate 0.2% → 93.8% on /api/cart"
    # Extra structured data specific to the kind (e.g. the 3σ bound we
    # compared against). Optional; the detail string is the human source of
    # truth.
    extra: dict[str, float] = Field(default_factory=dict)
