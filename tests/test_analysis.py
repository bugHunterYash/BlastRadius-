# =============================================================================
# Analysis tests — run: python tests/test_analysis.py
# =============================================================================
# D1–D4 pure logic. Load-bearing assertions (spec §16 test matrix T5/T6):
#   T5 (hand-computed percentiles): p95 of a known 20-value set — catches
#      off-by-one in nearest-rank AND any future "just average the buckets"
#      regression (bucket p95s in the fixture are deliberately MISLEADING).
#   T6: recovery never assumed — zero-request buckets don't count, timeout
#      says "not recovered", straddling windows don't count.
# =============================================================================

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from core.analysis import (
    BreakingPoint,
    breaking_point,
    build_evidence,
    compute_percentiles,
    evaluate_slo,
    measure_recovery,
    nearest_rank,
    phase_stats,
    verified_services,
)
from core.schemas.experiment import SLO
from core.schemas.metrics import (
    EvidenceKind,
    MetricBucket,
    MetricStatus,
    OptionalMetric,
    RawSample,
)

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


def bucket(elapsed: float, *, phase: str = "baseline", mult: float = 1.0,
           requests: int = 20, failures: int = 0, p95: float | None = 100.0,
           health: dict | None = None) -> MetricBucket:
    return MetricBucket(
        t=T0 + timedelta(seconds=elapsed),
        elapsed_s=elapsed,
        phase=phase,
        load_multiplier=mult,
        target_rps=20.0 * mult,
        requests=requests,
        successes=requests - failures,
        failures=failures,
        rps=float(requests),
        error_rate=failures / requests if requests else 0.0,
        p50_ms=50.0 if requests else None,
        p95_ms=p95 if requests else None,
        max_ms=(p95 or 0) * 1.5 if requests else None,
        health=health or {},
    )


def sample(t: float, dur: float, ep: str = "/api", status: int = 200, err: str = "") -> RawSample:
    return RawSample(t=t, duration_ms=dur, endpoint=ep, status=status, error=err)


def main() -> int:
    # =========================================================================
    # percentiles — nearest-rank, hand-computed
    # =========================================================================
    p = compute_percentiles([float(i) for i in range(1, 101)])  # 1..100
    assert_true("p50 of 1..100 = 50", p.p50_ms == 50, f"got {p.p50_ms}")
    assert_true("p95 of 1..100 = 95 (T5 off-by-one guard)", p.p95_ms == 95, f"got {p.p95_ms}")
    assert_true("p99 of 1..100 = 99", p.p99_ms == 99, f"got {p.p99_ms}")
    assert_true("max of 1..100 = 100", p.max_ms == 100)
    assert_true("n=100 → p99 trusted", p.p99_trusted)

    p = compute_percentiles([10.0, 20.0, 30.0, 40.0])
    assert_true("p50 of 4 values = 2nd (nearest-rank)", p.p50_ms == 20, f"got {p.p50_ms}")
    assert_true("p95 of 4 values = max", p.p95_ms == 40)
    assert_true("n=4 → p99 untrusted", not p.p99_trusted)

    p = compute_percentiles([])
    assert_true("empty → all None, n=0", p.n == 0 and p.p95_ms is None)

    assert_true("nearest_rank p=50 on [7] = 7", nearest_rank([7.0], 50) == 7.0)

    # =========================================================================
    # evaluate_slo — each dimension in isolation
    # =========================================================================
    slo = SLO(p95_ms=300, max_error_rate=0.01, min_rps_ratio=0.95)
    assert_true("healthy values → no breaches",
                evaluate_slo(p95_ms=200, error_rate=0.0, achieved_rps=20, target_rps=20, slo=slo) == [])
    assert_true("p95 breach only",
                evaluate_slo(p95_ms=301, error_rate=0.0, achieved_rps=20, target_rps=20, slo=slo) == ["p95"])
    assert_true("error_rate breach only",
                evaluate_slo(p95_ms=100, error_rate=0.02, achieved_rps=20, target_rps=20, slo=slo) == ["error_rate"])
    assert_true("throughput breach (80 < 0.95*100)",
                evaluate_slo(p95_ms=100, error_rate=0.0, achieved_rps=80, target_rps=100, slo=slo) == ["throughput"])
    assert_true("throughput ok at 96 ≥ 95",
                evaluate_slo(p95_ms=100, error_rate=0.0, achieved_rps=96, target_rps=100, slo=slo) == [])
    assert_true("target_rps=0 skips throughput check",
                evaluate_slo(p95_ms=100, error_rate=0.0, achieved_rps=0, target_rps=0, slo=slo) == [])
    assert_true("p95=None is not a p95 breach (honesty: no data ≠ breach)",
                evaluate_slo(p95_ms=None, error_rate=0.0, achieved_rps=20, target_rps=20, slo=slo) == [])

    # =========================================================================
    # breaking_point — range semantics
    # =========================================================================
    def stats(mult: float, breaches: list) -> object:
        from core.schemas.metrics import PhaseStats
        return PhaseStats(
            phase="load_step", load_multiplier=mult,
            start=T0, end=T0, requests=100, error_rate=0.0, rps=20.0,
            p50_ms=50, p95_ms=100, p99_ms=OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE, reason="n/a"),
            max_ms=200, slo_breaches=breaches,
        )

    bp = breaking_point([stats(5.0, ["p95"]), stats(1.0, []), stats(2.0, [])])
    assert_true("breaking point: highest_pass=2, first_breach=5",
                bp.highest_pass == 2.0 and bp.first_breach == 5.0,
                f"got {bp.highest_pass}/{bp.first_breach}")
    assert_true("breached_steps lists (5.0, ['p95'])",
                bp.breached_steps == [(5.0, ["p95"])])

    bp = breaking_point([stats(1.0, []), stats(10.0, [])])
    assert_true("no breach: first_breach=None, no_breach_up_to=10",
                bp.first_breach is None and bp.no_breach_up_to == 10.0)

    bp = breaking_point([stats(1.0, ["error_rate"])])
    assert_true("all breach: highest_pass=None",
                bp.highest_pass is None and bp.first_breach == 1.0)

    # =========================================================================
    # phase_stats — fault-style grouping, raw-driven percentiles (T5 trap)
    # =========================================================================
    # Baseline: 5 buckets × 20 req, raw durations all 100ms, but bucket p95
    # fields are set to 999 — if phase_stats ever reads bucket p95s instead
    # of recomputing from raw, p95 becomes 999 and this test fails.
    base_buckets = [bucket(e, phase="baseline", requests=20, failures=0, p95=999.0)
                    for e in range(0, 5)]
    base_samples = [sample(e + 0.5, 100.0) for e in range(0, 5) for _ in range(20)]

    fault_buckets = [bucket(e, phase="fault", requests=20, failures=10, p95=999.0)
                     for e in range(5, 10)]
    fault_samples = [sample(e + 0.5, 100.0, status=(500 if i % 2 == 0 else 200))
                     for e in range(5, 10) for i in range(20)]

    stats_list = phase_stats(base_buckets + fault_buckets, base_samples + fault_samples, slo,
                             group_by="phase")
    assert_true("two phase groups", len(stats_list) == 2, f"got {len(stats_list)}")
    by_phase = {s.phase: s for s in stats_list}
    assert_true("baseline p95 from RAW (100), not bucket field (999)",
                by_phase["baseline"].p95_ms == 100.0,
                f"got {by_phase['baseline'].p95_ms}")
    assert_true("baseline error_rate 0, no breaches",
                by_phase["baseline"].error_rate == 0.0 and by_phase["baseline"].slo_breaches == [])
    assert_true("fault error_rate 0.5 breaches error_rate",
                by_phase["fault"].error_rate == 0.5 and "error_rate" in by_phase["fault"].slo_breaches)
    assert_true("fault requests summed (100)", by_phase["fault"].requests == 100)

    # =========================================================================
    # phase_stats — capacity grouping + throughput + ramp trim
    # =========================================================================
    # Step 1.0 at elapsed 0..9: 20 req/s vs target 20 → 100% ≥ 95% → pass.
    # Step 2.0 at elapsed 10..19: 18 req/s vs target 40 → 45% < 95% → breach.
    cap_buckets = (
        [bucket(e, phase="load_step", mult=1.0, requests=20, p95=100.0) for e in range(0, 10)]
        + [bucket(e, phase="load_step", mult=2.0, requests=18, p95=100.0) for e in range(10, 20)]
    )
    cap_samples = (
        [sample(e + 0.5, 50.0) for e in range(0, 10) for _ in range(18)]
        + [sample(e + 0.5, 50.0) for e in range(10, 20) for _ in range(18)]
    )
    cap_stats = phase_stats(
        cap_buckets, cap_samples, slo,
        group_by="multiplier",
        target_rps_at={1.0: 20.0, 2.0: 40.0},
    )
    assert_true("capacity: two step groups", len(cap_stats) == 2)
    by_mult = {s.load_multiplier: s for s in cap_stats}
    assert_true("step 1.0 achieves 20/20 → throughput ok",
                by_mult[1.0].slo_breaches == [], f"got {by_mult[1.0].slo_breaches}")
    assert_true("step 2.0 achieves 18 < 0.95*40 → throughput breach",
                by_mult[2.0].slo_breaches == ["throughput"],
                f"got {by_mult[2.0].slo_breaches}")
    bp = breaking_point(cap_stats)
    assert_true("capacity breaking point: pass at 1.0, breach at 2.0",
                bp.highest_pass == 1.0 and bp.first_breach == 2.0)

    # Ramp trim: step 2.0's first 5s are ramp → excluded from stats.
    trim_stats = phase_stats(
        cap_buckets, cap_samples, slo,
        group_by="multiplier",
        target_rps_at={1.0: 20.0, 2.0: 40.0},
        trim_ramp_s=5,
    )
    t2 = {s.load_multiplier: s for s in trim_stats}[2.0]
    assert_true("ramp trim excludes first 5 buckets of step 2.0 (90 req, not 180)",
                t2.requests == 90, f"got {t2.requests}")

    # =========================================================================
    # measure_recovery — T6 honesty rules
    # =========================================================================
    # restore at 30s; healthy buckets 32..36 → stable_s=3 → recovered at 32
    rec_buckets = (
        [bucket(e, phase="fault", requests=20, failures=20, p95=900.0) for e in range(28, 32)]
        + [bucket(e, phase="recovery", requests=20, failures=0, p95=120.0) for e in range(32, 37)]
    )
    r = measure_recovery(rec_buckets, restore_elapsed_s=30.0, slo=slo, stable_s=3, timeout_s=60)
    assert_true("recovered after 2s (first stable at 32)", r.recovered and r.recovery_time_s == 2.0,
                f"got {r}")
    assert_true("recovery reason is the exact report sentence",
                "recovered 2s after restore" in r.reason, f"got {r.reason}")

    # Zero-request buckets must NOT count as stability
    empty_buckets = [bucket(e, phase="recovery", requests=0, p95=None) for e in range(30, 45)]
    r = measure_recovery(empty_buckets, restore_elapsed_s=30.0, slo=slo, stable_s=3, timeout_s=10)
    assert_true("zero-request buckets prove nothing → not recovered",
                not r.recovered, f"got {r}")

    # Never recovered within timeout
    bad = [bucket(e, phase="recovery", requests=20, failures=20, p95=900.0) for e in range(30, 50)]
    r = measure_recovery(bad, restore_elapsed_s=30.0, slo=slo, stable_s=3, timeout_s=10)
    assert_true("timeout → not recovered with fixed wording",
                not r.recovered and "not recovered within 10s" in r.reason, f"got {r}")

    # Straddling window: healthy 58..62, deadline 60 → too late
    straddle = (
        [bucket(e, phase="recovery", requests=20, failures=20, p95=900.0) for e in range(50, 58)]
        + [bucket(e, phase="recovery", requests=20, failures=0, p95=100.0) for e in range(58, 63)]
    )
    r = measure_recovery(straddle, restore_elapsed_s=50.0, slo=slo, stable_s=3, timeout_s=10)
    assert_true("stable window straddling deadline does not count",
                not r.recovered, f"got {r}")

    # No post-restore data at all
    r = measure_recovery([bucket(e, phase="fault") for e in range(0, 10)],
                         restore_elapsed_s=30.0, slo=slo)
    assert_true("no data after restore → explicit reason",
                not r.recovered and "no measurement data" in r.reason, f"got {r}")

    # =========================================================================
    # evidence — three rules + gates
    # =========================================================================
    window = (T0, T0 + timedelta(seconds=20))

    # 1a. clear error spike on /api/cart (attributed to demo-api)
    base = [sample(i * 0.5, 90.0, "/api/cart") for i in range(40)]
    fault = ([sample(10 + i * 0.5, 90.0, "/api/cart", status=500) for i in range(30)]
             + [sample(10 + i * 0.5, 90.0, "/api/cart") for i in range(10)])
    ev = build_evidence(
        baseline_samples=base, fault_samples=fault,
        baseline_buckets=[], fault_buckets=[],
        service_endpoints={"demo-api": ["/api/cart"]},
        window_start=window[0], window_end=window[1],
    )
    assert_true("error spike produces REQUEST_ERRORS evidence",
                any(e.kind == EvidenceKind.REQUEST_ERRORS for e in ev), f"got {ev}")
    row = next(e for e in ev if e.kind == EvidenceKind.REQUEST_ERRORS)
    assert_true("evidence carries baseline 0.0 → observed 0.75",
                row.baseline_value == 0.0 and row.observed_value == 0.75,
                f"got {row.baseline_value}/{row.observed_value}")
    assert_true("evidence sample_count = fault request count (40)",
                row.sample_count == 40, f"got {row.sample_count}")

    # 1b. rise gate: +2pp → no evidence
    fault_small = [sample(10 + i * 0.5, 90.0, "/api/cart", status=500 if i % 50 == 0 else 200)
                   for i in range(100)]
    ev = build_evidence(
        baseline_samples=base, fault_samples=fault_small,
        baseline_buckets=[], fault_buckets=[],
        service_endpoints={"demo-api": ["/api/cart"]},
        window_start=window[0], window_end=window[1],
    )
    assert_true("2pp rise filtered by the 5pp gate",
                not any(e.kind == EvidenceKind.REQUEST_ERRORS for e in ev), f"got {ev}")

    # 1c. noise gate: baseline is a flaky endpoint (even seconds 0%, odd
    # seconds 100% → mean 0.5, σ 0.5, bound = 0.5 + 3×0.5 = 2.0). A fault
    # window at 60% rises ≥5pp over baseline's 50% aggregate, but never
    # clears the noise bound → filtered.
    flaky_base = [
        sample(sec + 0.1 * k, 90.0, "/flaky", status=(500 if sec % 2 == 1 else 200))
        for sec in range(20) for k in range(2)
    ]
    flaky_fault = [
        sample(10 + i * 0.5, 90.0, "/flaky", status=(500 if i % 5 < 3 else 200))
        for i in range(40)
    ]
    ev = build_evidence(
        baseline_samples=flaky_base, fault_samples=flaky_fault,
        baseline_buckets=[], fault_buckets=[],
        service_endpoints={"demo-api": ["/flaky"]},
        window_start=window[0], window_end=window[1],
    )
    assert_true("rise within baseline noise (3σ) filtered",
                not any(e.kind == EvidenceKind.REQUEST_ERRORS for e in ev), f"got {ev}")

    # 2. latency regression: 100 → 200 (+100%, +100ms)
    lat_base = [sample(i * 0.1, 100.0, "/slow") for i in range(50)]
    lat_fault = [sample(10 + i * 0.1, 200.0, "/slow") for i in range(50)]
    ev = build_evidence(
        baseline_samples=lat_base, fault_samples=lat_fault,
        baseline_buckets=[], fault_buckets=[],
        service_endpoints={"demo-worker": ["/slow"]},
        window_start=window[0], window_end=window[1],
    )
    assert_true("latency regression detected",
                any(e.kind == EvidenceKind.LATENCY_REGRESSION for e in ev), f"got {ev}")

    # absolute gate: 40 → 70 (+75% but only +30ms) → no
    lat_fault2 = [sample(10 + i * 0.1, 70.0, "/slow") for i in range(50)]
    lat_base2 = [sample(i * 0.1, 40.0, "/slow") for i in range(50)]
    ev = build_evidence(
        baseline_samples=lat_base2, fault_samples=lat_fault2,
        baseline_buckets=[], fault_buckets=[],
        service_endpoints={"demo-worker": ["/slow"]},
        window_start=window[0], window_end=window[1],
    )
    assert_true("+75% but +30ms filtered by absolute gate",
                not any(e.kind == EvidenceKind.LATENCY_REGRESSION for e in ev), f"got {ev}")

    # 3. health flip
    hb = [bucket(e, phase="baseline", health={"demo-redis": "healthy"}) for e in range(0, 5)]
    hfb = [bucket(e, phase="fault", health={"demo-redis": "unhealthy"}) for e in range(5, 10)]
    ev = build_evidence(
        baseline_samples=[], fault_samples=[],
        baseline_buckets=hb, fault_buckets=hfb,
        service_endpoints={"demo-redis": []},
        window_start=window[0], window_end=window[1],
    )
    assert_true("health flip produces HEALTH_CHECK evidence",
                any(e.kind == EvidenceKind.HEALTH_CHECK for e in ev), f"got {ev}")

    # already unhealthy in baseline → not the fault's doing
    hb_bad = [bucket(e, phase="baseline", health={"demo-redis": "unhealthy"}) for e in range(0, 5)]
    ev = build_evidence(
        baseline_samples=[], fault_samples=[],
        baseline_buckets=hb_bad, fault_buckets=hfb,
        service_endpoints={"demo-redis": []},
        window_start=window[0], window_end=window[1],
    )
    assert_true("pre-existing unhealthy not attributed to the fault",
                not any(e.kind == EvidenceKind.HEALTH_CHECK for e in ev), f"got {ev}")

    # verified_services aggregation
    all_ev = build_evidence(
        baseline_samples=base, fault_samples=fault,
        baseline_buckets=hb, fault_buckets=hfb,
        service_endpoints={"demo-api": ["/api/cart"], "demo-redis": []},
        window_start=window[0], window_end=window[1],
    )
    assert_true("verified_services = {demo-api, demo-redis}",
                verified_services(all_ev) == {"demo-api", "demo-redis"},
                f"got {verified_services(all_ev)}")

    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
