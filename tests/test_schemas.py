# =============================================================================
# Schema smoke test — run: python -m tests.test_schemas (from repo root)
# =============================================================================
# WHY this exists before pytest: validates every safety-critical validator in
# core/schemas without needing pytest installed (pip was flaky). When pytest
# lands, these cases migrate into tests/unit/ as individual test functions.
# =============================================================================

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

# Allow running as a plain script from repo root: python tests/test_schemas.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Windows consoles default to cp1252, which crashes on unicode in output.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from pydantic import ValidationError

from core.schemas import (
    ArchitectureGraph,
    Comparison,
    ComposeModel,
    ComposeService,
    DependencyEdge,
    EdgeSource,
    Evidence,
    EvidenceKind,
    ExperimentCreate,
    ExperimentState,
    ExperimentType,
    FaultConfig,
    FaultKind,
    GapFinding,
    GapSeverity,
    LoadConfig,
    MetricBucket,
    MetricStatus,
    OptionalMetric,
    PreflightCheck,
    PreflightResult,
    Recommendation,
    RecommendationPriority,
    Report,
    SLO,
    SafetyLimits,
)

PASS = 0
FAIL = 0


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"  PASS  {name}")


def expect_fail(name: str, fn) -> None:
    """Assert that fn() raises a Pydantic ValidationError. Prints the reason —
    so we also verify the ERROR MESSAGE is the helpful one, not a generic
    'value is not a valid dict'."""
    global FAIL
    try:
        fn()
    except ValidationError as e:
        msg = e.errors()[0]["msg"]
        global PASS
        PASS += 1
        print(f"  PASS  {name}")
        print(f"        -> {msg[:80]}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}: should have raised but did not")


def main() -> int:
    # ---------- ComposeService.environment normalization ----------
    s = ComposeService(name="api", environment=["REDIS_URL=redis://r:6379", "FLAG"])
    assert s.environment == {"REDIS_URL": "redis://r:6379", "FLAG": ""}
    ok("env list form -> dict (bare KEY becomes empty string)")

    s2 = ComposeService(name="api", environment={"A": "1", "B": None})
    assert s2.environment == {"A": "1", "B": ""}
    ok("env map with None value -> empty string")

    expect_fail("env wrong type rejected", lambda: ComposeService(name="x", environment=42))

    # ---------- ComposeModel guards ----------
    expect_fail("empty services map rejected", lambda: ComposeModel(services={}))

    # ---------- LoadConfig hard caps (safety layer 1) ----------
    good = dict(target_base_url="http://demo-api:3000", endpoints=["/health"], baseline_rps=20)
    lc = LoadConfig(**good, multipliers=[1, 2, 5, 10], step_duration_s=20)
    # 4 multipliers x (20s step + 5s ramp) = 100s — matches the same formula
    # the cap validator uses, so this pins the contract both rely on.
    assert lc.total_duration_s == 100
    ok("valid ramp config, total_duration_s == 100")

    # NOTE: build variants with {**good, "key": val} — never LoadConfig(**good, key=...),
    # because `good` already contains overlapping keys (would be a duplicate-kwarg TypeError).
    expect_fail("peak RPS > 500 rejected", lambda: LoadConfig(**{**good, "baseline_rps": 200, "multipliers": [10]}))
    expect_fail("descending multipliers rejected", lambda: LoadConfig(**{**good, "multipliers": [5, 2]}))
    expect_fail("zero multiplier rejected", lambda: LoadConfig(**{**good, "multipliers": [0]}))
    expect_fail("total duration > 300s rejected", lambda: LoadConfig(**{**good, "multipliers": [1] * 8, "step_duration_s": 120, "ramp_s": 30}))
    expect_fail("endpoint with scheme rejected (host smuggling)", lambda: LoadConfig(**{**good, "endpoints": ["http://evil.com/x"]}))
    expect_fail("endpoint not starting with / rejected", lambda: LoadConfig(**{**good, "endpoints": ["api/x"]}))
    expect_fail("max_vus > 200 rejected", lambda: LoadConfig(**{**good, "max_vus": 201}))
    expect_fail("timeout > 10s rejected", lambda: LoadConfig(**{**good, "request_timeout_s": 11}))
    expect_fail("baseline_rps > 500 rejected", lambda: LoadConfig(**{**good, "baseline_rps": 501}))

    # ---------- FaultConfig ----------
    f = FaultConfig(kind=FaultKind.STOP_CONTAINER, target_service="demo-redis")
    assert f.baseline_s == 20 and f.recovery_stable_s == 5 and f.recovery_timeout_s == 60
    ok("fault config defaults (20/20/60/5)")
    expect_fail("LATENCY without latency_ms rejected", lambda: FaultConfig(kind=FaultKind.LATENCY, target_service="demo-api"))
    expect_fail("hostile service name rejected", lambda: FaultConfig(kind=FaultKind.STOP_CONTAINER, target_service="../etc"))

    # ---------- ExperimentCreate cross-field rules ----------
    # Fault timeline (20+20+60=100s) must fit inside the load duration:
    # lc1 covers it exactly (step 100, no ramp).
    lc1 = LoadConfig(**good, multipliers=[1], step_duration_s=100, ramp_s=0)
    fault_cfg = FaultConfig(kind=FaultKind.STOP_CONTAINER, target_service="demo-redis")
    base = dict(name="t", type=ExperimentType.FAULT, load=lc1, fault=fault_cfg)
    ExperimentCreate(**base)
    ok("fault experiment with constant load valid")

    expect_fail("FAULT without fault rejected", lambda: ExperimentCreate(name="t", type=ExperimentType.FAULT, load=lc1))
    expect_fail("CAPACITY with fault rejected", lambda: ExperimentCreate(name="t", type=ExperimentType.CAPACITY, load=lc1, fault=fault_cfg))
    expect_fail(
        "fault timeline not covered by load rejected (25s < 100s)",
        lambda: ExperimentCreate(name="t", type=ExperimentType.FAULT,
                                 load=LoadConfig(**good, multipliers=[1]),
                                 fault=fault_cfg),
    )

    ramp = LoadConfig(**good, multipliers=[1, 2, 5], step_duration_s=40, ramp_s=0)
    expect_fail("FAULT with ramp rejected (two variables)", lambda: ExperimentCreate(name="t", type=ExperimentType.FAULT, load=ramp, fault=fault_cfg))

    # FAULT_UNDER_LOAD with both is allowed (confounded but explicit);
    # load 3×40s=120s still covers the 100s fault timeline.
    ExperimentCreate(name="t", type=ExperimentType.FAULT_UNDER_LOAD, load=ramp, fault=fault_cfg)
    ok("FAULT_UNDER_LOAD with ramp allowed (confounded flag lives on Report)")

    # ---------- SLO / SafetyLimits bounds ----------
    expect_fail("SLO p95 above 60s rejected", lambda: SLO(p95_ms=60_001))
    expect_fail("SLO error_rate above 1 rejected", lambda: SLO(max_error_rate=1.5))
    expect_fail("safety consecutive_seconds > 60 rejected", lambda: SafetyLimits(consecutive_seconds=61))
    expect_fail("safety max_error_rate == 1.0 rejected (no headroom)", lambda: SafetyLimits(max_error_rate=1.0))
    SLO()
    SafetyLimits()
    ok("SLO + SafetyLimits defaults construct")

    # ---------- Preflight integrity ----------
    PreflightResult(passed=True, checks=[PreflightCheck(id="a", label="A", passed=True, detail="ok")])
    ok("consistent preflight (all passed)")
    PreflightResult(passed=False, checks=[PreflightCheck(id="a", label="A", passed=False, detail="bad")])
    ok("consistent preflight (all failed)")
    expect_fail(
        "lying preflight rejected (passed=True but a check failed)",
        lambda: PreflightResult(passed=True, checks=[PreflightCheck(id="a", label="A", passed=False, detail="x")]),
    )

    # ---------- DependencyEdge verified-needs-experiment invariant ----------
    DependencyEdge(source="api", target="redis", sources=[EdgeSource.DECLARED], reasons=["depends_on"])
    ok("declared edge valid")
    expect_fail("VERIFIED without experiment id rejected", lambda: DependencyEdge(source="a", target="b", sources=[EdgeSource.VERIFIED]))
    DependencyEdge(source="a", target="b", sources=[EdgeSource.VERIFIED], verified_by=[uuid4()])
    ok("VERIFIED with experiment id valid")
    expect_fail("edge with no sources rejected", lambda: DependencyEdge(source="a", target="b", sources=[]))

    # ---------- OptionalMetric honesty ----------
    OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE, reason="no socket")
    ok("unavailable metric with reason")
    expect_fail("UNAVAILABLE without reason rejected", lambda: OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE))
    expect_fail("LOW_SAMPLE without reason rejected", lambda: OptionalMetric(value=1.0, status=MetricStatus.LOW_SAMPLE))
    OptionalMetric(value=0.0, status=MetricStatus.OK)
    ok("OK metric with value 0 allowed (real zero, not fake)")

    # ---------- MetricBucket defaults are honest ----------
    mb = MetricBucket(
        t=datetime.now(timezone.utc), elapsed_s=1.0, phase="baseline",
        load_multiplier=1.0, target_rps=20.0,
    )
    assert mb.p99_ms.status == MetricStatus.UNAVAILABLE and "no samples" in (mb.p99_ms.reason or "")
    ok("fresh bucket: p99 unavailable, NOT zero-filled")
    assert mb.db_connections.status == MetricStatus.UNAVAILABLE and "DEMO_DB_URL" in (mb.db_connections.reason or "")
    ok("fresh bucket: db_connections unavailable with reason")
    assert mb.cpu_pct == {} and mb.health == {}
    ok("fresh bucket: no fabricated per-service data")

    # ---------- Report defaults to the honest values ----------
    exp = ExperimentCreate(**base)
    rp = Report(experiment_id=uuid4(), generated_at=datetime.now(timezone.utc), config=exp, final_state=ExperimentState.COMPLETED)
    assert rp.bottleneck == "unknown"
    ok("report.bottleneck defaults to 'unknown'")
    assert rp.confounded is False and rp.data_source == "live"
    ok("report confounded=False, data_source=live")

    # ---------- Evidence + Recommendation shapes ----------
    ev = Evidence(
        service="demo-api", kind=EvidenceKind.REQUEST_ERRORS, metric="error_rate:/api/cart",
        baseline_value=0.002, observed_value=0.938,
        window_start=datetime.now(timezone.utc), window_end=datetime.now(timezone.utc),
        sample_count=412, detail="error rate 0.2% → 93.8% on /api/cart",
    )
    assert ev.sample_count == 412
    ok("evidence item constructs with full audit trail")
    rec = Recommendation(priority=RecommendationPriority.P1, title="Add cache fallback for /api/cart",
                         rationale="Redis stop caused 94% errors", evidence_refs=[0])
    assert rec.evidence_refs == [0]
    ok("recommendation links to evidence index 0")

    # ---------- GapFinding ----------
    g = GapFinding(rule_id="missing-healthcheck", severity=GapSeverity.MEDIUM, service="demo-api",
                   detail="no healthcheck defined", compose_path="services.demo-api.healthcheck")
    assert g.rule_id == "missing-healthcheck"
    ok("gap finding constructs")

    # ---------- Graph round-trip (JSON serializable) ----------
    graph = ArchitectureGraph(id=uuid4(), name="demo", nodes=[], edges=[], gaps=[g])
    graph2 = ArchitectureGraph.model_validate_json(graph.model_dump_json())
    assert graph2.id == graph.id and graph2.gaps[0].rule_id == "missing-healthcheck"
    ok("ArchitectureGraph JSON round-trip")

    # ---------- Comparison ----------
    cmp_ = Comparison(before=rp, after=rp, deltas={"p95_ms": -180.0}, fairness_warning=None)
    assert cmp_.deltas["p95_ms"] == -180.0
    ok("comparison constructs")

    # ---------- Summary ----------
    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
