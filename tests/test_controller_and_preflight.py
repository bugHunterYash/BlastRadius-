# =============================================================================
# Preflight & Controller Integration Tests — run: python tests/test_controller_and_preflight.py
# =============================================================================

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from core.controller.experiment import ExperimentController
from core.controller.schedule import PhaseSchedule
from core.load.runner import K6Runner
from core.safety.preflight import run_preflight
from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentState,
    ExperimentType,
    FaultConfig,
    FaultKind,
    LoadConfig,
    PreflightResult,
    SafetyLimits,
    SLO,
)
from core.store import Store

PASS = 0
FAIL = 0


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


def make_fault_experiment(name: str = "exp-test") -> ExperimentCreate:
    return ExperimentCreate(
        name=name,
        type=ExperimentType.FAULT,
        load=LoadConfig(
            target_base_url="http://127.0.0.1:8080",
            endpoints=["/api/test"],
            baseline_rps=10,
            multipliers=[1.0],
            step_duration_s=20,
            ramp_s=0,
        ),
        fault=FaultConfig(
            kind=FaultKind.STOP_CONTAINER,
            target_service="demo-redis",
            baseline_s=5,
            fault_s=5,
            recovery_timeout_s=10,
            recovery_stable_s=2,
        ),
        slo=SLO(p95_ms=300, max_error_rate=0.05),
        safety_limits=SafetyLimits(max_error_rate=0.8, consecutive_seconds=3),
    )


def make_capacity_experiment(name: str = "exp-cap") -> ExperimentCreate:
    return ExperimentCreate(
        name=name,
        type=ExperimentType.CAPACITY,
        load=LoadConfig(
            target_base_url="http://127.0.0.1:8080",
            endpoints=["/api/test"],
            baseline_rps=10,
            multipliers=[1.0, 2.0],
            step_duration_s=5,
            ramp_s=2,
        ),
        slo=SLO(p95_ms=300, max_error_rate=0.05),
        safety_limits=SafetyLimits(max_error_rate=0.8, consecutive_seconds=3),
    )


def test_preflight():
    print("\n--- Testing 9-point Preflight ---")
    exp = make_fault_experiment()

    # Preflight in mock/skip_docker mode with simulated healthy target
    res = run_preflight(
        exp,
        skip_docker=True,
        health_prober=lambda url: True,
        load_allowlist=["127.0.0.1", "localhost"],
        fault_allowlist=["demo-redis"],
    )

    assert_true("preflight returns 9 checks", len(res.checks) == 9)
    assert_true("preflight passes when all checks pass", res.passed is True)
    check_ids = [c.id for c in res.checks]
    assert_true("contains env-label", "env-label" in check_ids)
    assert_true("contains fault-allowlist", "fault-allowlist" in check_ids)
    assert_true("contains production-guard", "production-guard" in check_ids)
    assert_true("contains network-isolation", "network-isolation" in check_ids)
    assert_true("contains load-allowlist", "load-allowlist" in check_ids)
    assert_true("contains limits", "limits" in check_ids)
    assert_true("contains target-health", "target-health" in check_ids)
    assert_true("contains no-concurrency", "no-concurrency" in check_ids)
    assert_true("contains restore-path", "restore-path" in check_ids)

    # Preflight fails when health check fails
    res_fail = run_preflight(
        exp,
        skip_docker=True,
        health_prober=lambda url: False,
        load_allowlist=["127.0.0.1"],
        fault_allowlist=["demo-redis"],
    )
    assert_true("health failure causes preflight to fail", res_fail.passed is False)
    failed_checks = [c for c in res_fail.checks if not c.passed]
    assert_true("target-health is among failed checks", any(c.id == "target-health" for c in failed_checks))


def test_schedule():
    print("\n--- Testing PhaseSchedule ---")
    fault_exp = make_fault_experiment()
    sched = PhaseSchedule.from_experiment(fault_exp)
    assert_true("fault schedule total duration is 20s", sched.total_duration_s == 20.0)

    p0, m0, r0 = sched.at(2.0)
    assert_true("0-5s is baseline", p0 == "baseline" and m0 == 1.0 and r0 == 10.0)

    p1, m1, r1 = sched.at(7.0)
    assert_true("5-10s is fault", p1 == "fault" and m1 == 1.0 and r1 == 10.0)

    p2, m2, r2 = sched.at(12.0)
    assert_true("10-20s is recovery", p2 == "recovery" and m2 == 1.0 and r2 == 10.0)

    cap_exp = make_capacity_experiment()
    cap_sched = PhaseSchedule.from_experiment(cap_exp)
    assert_true("capacity schedule duration is 14s (2 * 7s)", cap_sched.total_duration_s == 14.0)
    cp0, cm0, cr0 = cap_sched.at(3.0)
    assert_true("first step is load_step 1.0x", cp0 == "load_step" and cm0 == 1.0 and cr0 == 10.0)
    cp1, cm1, cr1 = cap_sched.at(9.0)
    assert_true("second step is load_step 2.0x", cp1 == "load_step" and cm1 == 2.0 and cr1 == 20.0)


def test_k6_runner():
    print("\n--- Testing K6Runner script preparation ---")
    exp = make_fault_experiment()
    runner = K6Runner(exp.load, exp.safety)
    script_path = runner.prepare_script()
    assert_true("script file created", script_path.exists())
    content = script_path.read_text(encoding="utf-8")
    assert_true("script contains base URL", "http://127.0.0.1:8080" in content)
    assert_true("script contains ramping-arrival-rate", "ramping-arrival-rate" in content)
    runner.cleanup()
    assert_true("temp dir cleaned up", not script_path.exists())


async def async_test_controller():
    print("\n--- Testing ExperimentController Execution ---")
    store = Store()
    controller = ExperimentController(store=store)

    exp = make_fault_experiment("controller-test")
    # Shorten durations for fast test execution
    exp = exp.model_copy(
        update={
            "fault": exp.fault.model_copy(
                update={"baseline_s": 5, "fault_s": 5, "recovery_timeout_s": 10, "recovery_stable_s": 2}
            ),
        }
    )

    eid = uuid4()
    preflight_res = run_preflight(
        exp,
        skip_docker=True,
        health_prober=lambda url: True,
        load_allowlist=["127.0.0.1"],
        fault_allowlist=["demo-redis"],
    )
    store.create_experiment(eid, exp, preflight_res, state=ExperimentState.PENDING)

    # Run experiment directly
    # We test the controller's simulation execution path
    task = asyncio.create_task(controller.run_experiment(eid))
    await asyncio.sleep(1.0)

    # Check that experiment moved to RUNNING
    rec = store.get_experiment(eid)
    assert_true("experiment transitioned to RUNNING", rec.state == ExperimentState.RUNNING)

    # Test abort kill switch
    controller.abort(eid)
    await asyncio.sleep(0.5)

    rec_aborted = store.get_experiment(eid)
    assert_true("experiment state became ABORTED on abort()", rec_aborted.state == ExperimentState.ABORTED)


def main() -> int:
    test_preflight()
    test_schedule()
    test_k6_runner()
    asyncio.run(async_test_controller())

    print("\n" + "=" * 60)
    print(f"  {PASS} passed, {FAIL} failed")
    print("=" * 60)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
