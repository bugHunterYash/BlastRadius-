# =============================================================================
# k6 script generation tests — run: python tests/test_script.py
# =============================================================================
# Module C1 (pure — no k6 binary required). Load-bearing assertions:
#   1. Stage durations SUM to LoadConfig.total_duration_s (watchdog vs
#      actual k6 wall-clock must not disagree)
#   2. Injection: a schema-passing path with quotes stays a JSON string
#      literal in the rendered source — never executable JS
#   3. abortOnFail thresholds encode SafetyLimits (caps layer 3 exists)
# =============================================================================

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from core.load import build_stages, estimate_requests, generate_k6_script
from core.schemas.experiment import LoadConfig, SafetyLimits

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


def stage_seconds(stages: list[dict]) -> int:
    return sum(int(s["duration"].rstrip("s")) for s in stages)


def main() -> int:
    load = LoadConfig(
        target_base_url="http://demo-api:3000",
        endpoints=["/health", "/api/products"],
        baseline_rps=20,
        multipliers=[1, 2, 5, 10],
        step_duration_s=20,
        ramp_s=5,
        max_vus=100,
    )

    rendered = generate_k6_script(load)

    # ---------- stage math ----------
    assert_true("8 stages (ramp+step per multiplier)", len(rendered.stages) == 8,
                f"got {len(rendered.stages)}")
    expected_targets = [20, 20, 40, 40, 100, 100, 200, 200]
    actual_targets = [s["target"] for s in rendered.stages]
    assert_true("stage targets = baseline x multiplier, paired ramp/step",
                actual_targets == expected_targets,
                f"got {actual_targets}")
    assert_true(
        "stage seconds sum to total_duration_s (watchdog agreement)",
        stage_seconds(rendered.stages) == load.total_duration_s,
        f"{stage_seconds(rendered.stages)} != {load.total_duration_s}",
    )
    assert_true("peak_rps = baseline x max multiplier",
                rendered.peak_rps == 200, f"got {rendered.peak_rps}")

    # ---------- estimate (hand-computed in test comment) ----------
    # m=1: (20+20)/2*5 + 20*20 = 100+400 = 500
    # m=2: (20+40)/2*5 + 40*20 = 150+800 = 950
    # m=5: (40+100)/2*5 + 100*20 = 350+2000 = 2350
    # m=10: (100+200)/2*5 + 200*20 = 750+4000 = 4750  → 8550
    assert_true("estimate_requests matches hand computation",
                rendered.estimated_requests == 8550,
                f"got {rendered.estimated_requests}")

    # ---------- rendered source: options block ----------
    src = rendered.source
    assert_true("ramping-arrival-rate executor present",
                "ramping-arrival-rate" in src)
    assert_true("startRate = baseline", "startRate: 20" in src)
    assert_true("maxVUs present", "maxVUs: 100" in src)
    assert_true("base URL has trailing slash stripped (no '//')",
                '"http://demo-api:3000"' in src and '"http://demo-api:3000/"' not in src,
                "BASE literal should be http://demo-api:3000")
    assert_true("endpoints JSON-escaped into ENDPOINTS",
                json.dumps(["/health", "/api/products"]) in src)

    # ---------- safety thresholds (caps layer 3) ----------
    assert_true("abortOnFail present on error threshold",
                src.count("abortOnFail: true") == 2)
    assert_true("error-rate threshold from SafetyLimits default",
                "rate<0.5" in src)
    assert_true("p95 threshold from SafetyLimits default",
                "p(95)<5000" in src)

    tight = SafetyLimits(max_error_rate=0.25, max_p95_ms=1500)
    r2 = generate_k6_script(load, safety=tight)
    assert_true("custom safety limits encoded",
                "rate<0.25" in r2.source and "p(95)<1500" in r2.source)

    # ---------- injection: schema-passing path must stay inert ----------
    sneaky = LoadConfig(
        target_base_url="http://demo-api:3000",
        endpoints=['/api/x";evil("'],
        baseline_rps=10,
        multipliers=[1.0],
    )
    r3 = generate_k6_script(sneaky)
    assert_true("quotes in endpoint do NOT appear raw in source",
                '/api/x";evil("' not in r3.source,
                "raw endpoint leaked into JS")
    assert_true("quotes appear JSON-escaped (inert string literal)",
                json.dumps('/api/x";evil("') in r3.source)

    # ---------- ramp_s = 0: ramp stages omitted, totals still agree ----------
    flat = LoadConfig(
        target_base_url="http://demo-api:3000",
        endpoints=["/health"],
        baseline_rps=50,
        multipliers=[1, 1],
        step_duration_s=15,
        ramp_s=0,
    )
    rf = generate_k6_script(flat)
    assert_true("ramp_s=0 → only step stages (no 0s stages)",
                len(rf.stages) == 2 and all(s["duration"] == "15s" for s in rf.stages),
                f"got {rf.stages}")
    assert_true("ramp_s=0 duration still matches schema",
                stage_seconds(rf.stages) == flat.total_duration_s)

    # ---------- fractional multiplier formatting ----------
    frac = LoadConfig(
        target_base_url="http://demo-api:3000",
        endpoints=["/health"],
        baseline_rps=20,
        multipliers=[1.0, 1.25],
        step_duration_s=10,
        ramp_s=0,
    )
    rf2 = generate_k6_script(frac)
    assert_true("fractional target kept as float (20 x 1.25 = 25 → int ok)",
                [s["target"] for s in rf2.stages] == [20, 25],
                f"got {[s['target'] for s in rf2.stages]}")

    # ---------- determinism + hash ----------
    again = generate_k6_script(load)
    assert_true("render is deterministic (byte-identical source)",
                again.source == rendered.source)
    import hashlib
    assert_true("script_sha256 matches recomputed hash",
                rendered.script_sha256 ==
                hashlib.sha256(rendered.source.encode("utf-8")).hexdigest())

    # ---------- single-multiplier (fault experiment shape) ----------
    const = LoadConfig(
        target_base_url="http://demo-api:3000",
        endpoints=["/health"],
        baseline_rps=30,
        multipliers=[1.0],     # fault runs: constant load
        step_duration_s=30,
        ramp_s=5,
    )
    rc = generate_k6_script(const)
    assert_true("constant-load shape: 2 stages, flat targets",
                [s["target"] for s in rc.stages] == [30, 30],
                f"got {rc.stages}")

    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
