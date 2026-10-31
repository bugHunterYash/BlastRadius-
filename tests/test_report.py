# =============================================================================
# Report + fix prompt + score + compare tests — run: python tests/test_report.py
# =============================================================================
# Load-bearing assertions (spec §16 T7/T8):
#   T7: fix prompt determinism + grounding — every number in the prompt must
#       come from the report; confounded runs must NOT contain causal fixes.
#   T8: score is a fixed formula (hand-computed) and compare refuses unfair
#       configs with an explicit warning (the pitch polices itself).
# =============================================================================

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from core.analysis import compare
from core.report import compute_score, finalize_report, generate_fix_prompt, recommendations_for
from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentState,
    ExperimentType,
    FaultConfig,
    FaultKind,
    LoadConfig,
    SLO,
)
from core.schemas.metrics import (
    Evidence,
    EvidenceKind,
    MetricStatus,
    OptionalMetric,
    PhaseStats,
)
from core.schemas.report import RecommendationPriority, Report

PASS = 0
FAIL = 0
T0 = datetime(2026, 1, 1, 12, 0, 0)


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"  PASS  {name}")


def fail(name: str, detail: str) -> None:
    global FAIL
    FAIL += 1
    print(f"  FAIL  {name}: {detail}")


def assert_true(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        ok(name)
    else:
        fail(name, detail or "condition was false")


def fault_config() -> FaultConfig:
    return FaultConfig(kind=FaultKind.STOP_CONTAINER, target_service="demo-redis",
                       baseline_s=20, fault_s=20, recovery_timeout_s=60, recovery_stable_s=5)


def make_config(*, exp_type: ExperimentType = ExperimentType.FAULT,
                baseline_rps: int = 20) -> ExperimentCreate:
    # FAULT runs need load ≥ fault timeline (20+20+60 = 100s) — see the
    # ExperimentCreate validator; step 100s with no ramp covers it exactly.
    is_fault = exp_type != ExperimentType.CAPACITY
    return ExperimentCreate(
        name="redis-under-load",
        type=exp_type,
        load=LoadConfig(
            target_base_url="http://demo-api:3000",
            endpoints=["/api/cart", "/health"],
            baseline_rps=baseline_rps,
            multipliers=[1.0] if is_fault else [1, 2, 5, 10],
            step_duration_s=100 if is_fault else 20,
            ramp_s=0 if is_fault else 5,
        ),
        fault=fault_config() if is_fault else None,
        slo=SLO(),
    )


def phase(name: str, *, mult: float = 1.0, breaches: list | None = None,
          p95: float = 120.0, err: float = 0.0, rps: float = 20.0) -> PhaseStats:
    return PhaseStats(
        phase=name, load_multiplier=mult, start=T0, end=T0 + timedelta(seconds=20),
        requests=400, error_rate=err, rps=rps,
        p50_ms=60.0, p95_ms=p95,
        p99_ms=OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE, reason="no samples"),
        max_ms=p95 * 2, slo_breaches=breaches or [],
    )


def ev(kind: EvidenceKind, service: str, *, metric: str = "error_rate:/api/cart",
       base: float = 0.0, obs: float = 0.75) -> Evidence:
    return Evidence(
        service=service, kind=kind, metric=metric,
        baseline_value=base, observed_value=obs,
        window_start=T0, window_end=T0 + timedelta(seconds=20),
        sample_count=40,
        detail=f"{service}: {metric} {base} → {obs}",
    )


def make_report(**overrides) -> Report:
    base = dict(
        experiment_id=UUID(int=1),
        generated_at=T0,
        config=make_config(),
        final_state=ExperimentState.COMPLETED,
        phases=[phase("baseline", p95=120), phase("fault", p95=450, breaches=["p95"], err=0.5)],
        evidence=[ev(EvidenceKind.REQUEST_ERRORS, "demo-api")],
        affected_services=["demo-api"],
        recovered=True,
        recovery_time_s=2.0,
        bottleneck="db_connection_exhaustion",
    )
    base.update(overrides)
    return Report(**base)


def main() -> int:
    # =========================================================================
    # recommendations rule table
    # =========================================================================
    r = make_report()
    recs = recommendations_for(r)
    titles = [rec.title for rec in recs]
    assert_true("error evidence → P1 graceful-degradation rec",
                any(rec.priority == RecommendationPriority.P1
                    and "graceful degradation for demo-api" in rec.title
                    for rec in recs), f"got {titles}")
    error_rec = next(rec for rec in recs if "graceful degradation" in rec.title)
    assert_true("error rec references evidence row 0",
                error_rec.evidence_refs == [0], f"got {error_rec.evidence_refs}")
    assert_true("bottleneck db pool → P1 pool rec",
                any("database pool capacity" in t for t in titles), f"got {titles}")

    lat = make_report(evidence=[
        ev(EvidenceKind.REQUEST_ERRORS, "demo-api"),
        ev(EvidenceKind.LATENCY_REGRESSION, "demo-worker", metric="p95_ms",
           base=100, obs=200),
    ], affected_services=["demo-api", "demo-worker"])
    lat_recs = recommendations_for(lat)
    assert_true("latency evidence → P2 rec",
                any(rec.priority == RecommendationPriority.P2
                    and "latency under load" in rec.title for rec in lat_recs))

    health = make_report(evidence=[
        ev(EvidenceKind.HEALTH_CHECK, "demo-postgres", metric="health"),
    ], affected_services=["demo-postgres"])
    assert_true("health evidence → P1 restart/healthcheck rec",
                any("restart policy and healthcheck for demo-postgres" in rec.title
                    for rec in recommendations_for(health)))

    nob = make_report(bottleneck="unknown", first_breach_multiplier=None,
                      recovered=None, recovery_time_s=None, phases=[phase("baseline")])
    nob_recs = recommendations_for(nob)
    assert_true("unknown bottleneck yields no bottleneck rec",
                not any("pool" in rec.title for rec in nob_recs))

    cap = make_report(config=make_config(exp_type=ExperimentType.CAPACITY),
                      first_breach_multiplier=5.0, highest_passing_multiplier=2.0,
                      tested_multipliers=[1.0, 2.0, 5.0, 10.0],
                      recovered=None, recovery_time_s=None,
                      bottleneck="cpu_bound")
    cap_recs = recommendations_for(cap)
    assert_true("capacity breach → P2 headroom rec",
                any("capacity headroom before 5.0" in rec.title for rec in cap_recs),
                f"got {[x.title for x in cap_recs]}")

    unrecovered = make_report(recovered=False)
    assert_true("failed recovery → P1 recovery rec",
                any("connection recovery" in rec.title
                    for rec in recommendations_for(unrecovered)))

    conf = make_report(confounded=True)
    conf_recs = recommendations_for(conf)
    assert_true("confounded → exactly the controlled-rerun placeholder",
                len(conf_recs) == 1 and "controlled experiment" in conf_recs[0].title,
                f"got {[x.title for x in conf_recs]}")

    # =========================================================================
    # fix prompt (T7)
    # =========================================================================
    finalized = finalize_report(make_report())
    prompt = finalized.fix_prompt
    assert_true("finalize_report sets fix_prompt", bool(prompt))
    for section in ("GOAL:", "MEASURED TODAY:", "FIX THESE, IN ORDER:",
                    "CONSTRAINTS", "ACCEPTANCE CRITERIA"):
        assert_true(f"prompt contains section '{section}'", section in (prompt or ""))

    assert_true("prompt shows measured evidence detail",
                "demo-api: error_rate:/api/cart 0.0 → 0.75" in (prompt or ""))
    assert_true("prompt shows recovery measurement",
                "recovered 2s after restore" in (prompt or "")
                or "Recovery after stop_container of demo-redis: 2s" in (prompt or ""),
                f"prompt: {prompt}")
    assert_true("prompt cites experiment name in acceptance",
                '"redis-under-load"' in (prompt or ""))
    assert_true("prompt has bottleneck-specific acceptance",
                "DB pool stays below 90%" in (prompt or ""))

    # P1 must appear before P2 in the numbered list (capacity report has both)
    cap_final = finalize_report(cap)
    p1_pos = (cap_final.fix_prompt or "").find("[P1]")
    p2_pos = (cap_final.fix_prompt or "").find("[P2]")
    assert_true("P1 listed before P2", 0 <= p1_pos < p2_pos,
                f"p1@{p1_pos} p2@{p2_pos}")

    # determinism (T7): same report → identical bytes
    again = finalize_report(make_report())
    assert_true("fix prompt byte-identical across regenerations",
                again.fix_prompt == prompt)

    # evidence refs rendered with numbers
    assert_true("recommendation evidence line rendered",
                "Evidence: error_rate:/api/cart: 0.0 → 0.75" in (prompt or ""),
                f"prompt: {prompt}")

    # confounded prompt: no causal fix list
    conf_prompt = generate_fix_prompt(make_report(confounded=True))
    assert_true("confounded prompt has controlled-rerun item",
                "controlled experiment" in conf_prompt)
    assert_true("confounded prompt warns about variables",
                "multiple variables" in conf_prompt)
    assert_true("confounded prompt lacks causal titles",
                "graceful degradation" not in conf_prompt)

    # no-evidence report still yields a valid prompt
    bare = finalize_report(make_report(evidence=[], affected_services=[],
                                       phases=[phase("baseline")],
                                       recovered=None, recovery_time_s=None,
                                       bottleneck="unknown"))
    assert_true("bare report prompt says no measurable impact",
                "No measurable impact recorded" in (bare.fix_prompt or ""))

    # capacity breaking-point wording
    cap_prompt = generate_fix_prompt(finalize_report(cap).model_copy(
        update={"fix_prompt": None}))
    assert_true("capacity prompt: breaking point range wording",
                "between 2.0× and 5.0×" in cap_prompt, f"prompt: {cap_prompt}")

    # =========================================================================
    # score (T8 hand-computed)
    # =========================================================================
    # clean fault run: breaches -15, recovered fast (0), 0 impacted (0),
    # no gaps, first_breach None (0), bottleneck known (0), no retest → 85
    clean = make_report(phases=[phase("baseline"), phase("fault", breaches=["p95"])],
                        evidence=[], affected_services=[],
                        bottleneck="cpu_bound", recovered=True, recovery_time_s=2.0)
    assert_true("score: breach run = 100-15 = 85 (hand-computed)",
                compute_score(clean) == 85, f"got {compute_score(clean)}")

    # worst-ish: breach -15, not recovered -10, 2 impacted -24, 2 gaps -16,
    # first_breach 1.0 -10, unknown -8 → 100-83 = 17
    broken = make_report(
        phases=[phase("fault", breaches=["p95", "error_rate"])],
        evidence=[ev(EvidenceKind.REQUEST_ERRORS, "demo-api"),
                  ev(EvidenceKind.HEALTH_CHECK, "demo-worker", metric="health")],
        affected_services=["demo-api", "demo-worker"],
        recovered=False, recovery_time_s=None,
        first_breach_multiplier=1.0, bottleneck="unknown",
    )
    assert_true("score: broken stack = 17 (hand-computed)",
                compute_score(broken, high_gap_count=2) == 17,
                f"got {compute_score(broken, high_gap_count=2)}")

    # caps: 5 impacted → cap 24 not 60; 9 gaps → cap 16 not 72
    many = make_report(
        evidence=[], affected_services=[f"s{i}" for i in range(5)],
        recovered=None, recovery_time_s=None, bottleneck="cpu_bound",
        phases=[phase("baseline")],
    )
    assert_true("impact penalty capped at 24",
                compute_score(many, high_gap_count=9) == 100 - 24 - 16,
                f"got {compute_score(many, high_gap_count=9)}")

    # retest bonus clamps at 100
    assert_true("retest bonus clamps at 100",
                compute_score(clean, retest_passed=True) == 95,  # 85 + 10
                f"got {compute_score(clean, retest_passed=True)}")
    perfect = make_report(phases=[phase("baseline")], evidence=[],
                          affected_services=[], bottleneck="cpu_bound",
                          recovered=None, recovery_time_s=None)
    assert_true("perfect + retest never exceeds 100",
                compute_score(perfect, retest_passed=True) == 100)

    # =========================================================================
    # compare (E2)
    # =========================================================================
    before = make_report()
    after = make_report(
        phases=[phase("baseline", p95=120), phase("fault", p95=150, err=0.01)],
        evidence=[], affected_services=[],
        recovery_time_s=1.0, bottleneck="cpu_bound",
    )
    cmp = compare(before, after)
    assert_true("fair configs → no fairness warning", cmp.fairness_warning is None,
                f"got {cmp.fairness_warning}")
    assert_true("p95 delta = after - before (150-450 = -300)",
                cmp.deltas["p95_ms"] == -300.0, f"got {cmp.deltas['p95_ms']}")
    assert_true("error_rate delta = 0.01 - 0.5 = -0.49",
                cmp.deltas["error_rate"] == -0.49, f"got {cmp.deltas['error_rate']}")
    assert_true("recovery delta = 1 - 2 = -1",
                cmp.deltas["recovery_time_s"] == -1.0)
    assert_true("slo flags: before False, after True",
                cmp.slo_before_passed is False and cmp.slo_after_passed is True)
    assert_true("recovered flags carried",
                cmp.recovered_before is True and cmp.recovered_after is True)

    # unfair config → warning names the mismatch
    unfair = make_report(config=make_config(baseline_rps=100))
    cmp2 = compare(before, unfair)
    assert_true("different baseline_rps → fairness warning",
                cmp2.fairness_warning is not None
                and "baseline_rps" in cmp2.fairness_warning,
                f"got {cmp2.fairness_warning}")

    # missing side → None delta, never fabricated 0
    no_phases = make_report(phases=[], evidence=[], affected_services=[],
                            recovered=None, recovery_time_s=None)
    cmp3 = compare(before, no_phases)
    assert_true("missing phase data → delta None (not 0)",
                cmp3.deltas["p95_ms"] is None and cmp3.slo_after_passed is None,
                f"got {cmp3.deltas['p95_ms']}/{cmp3.slo_after_passed}")

    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
