"""Scenario suite: scripted runs with planted bugs, scored against the issues we expect.

    python -m scenarios.run --all --report
    python -m scenarios.run cases/skip-reviewer.json

Each case is replayed through the real SDK against a running backend, so this measures the whole
path: ingest, version assignment, detectors. force_version n means "the n-th version this case
wrote", so cases don't depend on what earlier runs left in the notebook.
"""

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "sdk-python"))

import tower  # noqa: E402

Key = tuple[str, str, str | None]


def play(case: dict) -> str:
    written: dict[str, list[int]] = {}
    run_id = f"scn-{case['name']}-{uuid.uuid4().hex[:6]}"
    with tower.run(run_id, scenario=f"suite:{case['name']}"):
        for s in case["steps"]:
            with tower.as_agent(s["agent"]):
                if s["op"] == "write":
                    written.setdefault(s["fact_key"], []).append(tower.remember(s["fact_key"], s.get("value", "x")))
                elif s["op"] == "read":
                    n = s.get("force_version")
                    tower.recall(s["fact_key"], version=written[s["fact_key"]][n - 1] if n else None)
                elif s["op"] == "handoff":
                    tower.handoff(s["to"])
    return run_id


def wait_done(api: httpx.Client, run_id: str, timeout: float = 180) -> None:  # Ollama digests take ~50s on CPU
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if api.get(f"/v1/runs/{run_id}").json().get("status") in ("done", "error"):
            return
        time.sleep(0.2)
    raise TimeoutError(f"{run_id} was not analysed within {timeout}s")


def score(case: dict, found: set[Key]) -> tuple[set[Key], set[Key], set[Key]]:
    expected = {(e["type"], e["agent"], e.get("fact_key")) for e in case["expect"]}
    return expected & found, expected - found, found - expected


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="scenarios.run")
    p.add_argument("files", nargs="*")
    p.add_argument("--all", action="store_true")
    p.add_argument("--report", action="store_true", help="print the catch-rate line and per-detector table")
    p.add_argument("--api", default=os.environ.get("TOWER_API_URL", "http://localhost:8000"))
    a = p.parse_args(argv)
    files = sorted((ROOT / "cases").glob("*.json")) if a.all else [Path(f) for f in a.files]
    if not files:
        p.error("give case files or --all")

    tower.init(api_url=a.api)
    api = httpx.Client(base_url=a.api, timeout=15)
    caught = missed = false_alarms = 0
    per_type: dict[str, list[int]] = {}
    for f in files:
        case = json.loads(Path(f).read_text(encoding="utf-8"))
        run_id = play(case)
        wait_done(api, run_id)
        found = {(i["type"], i["agent"], i["fact_key"]) for i in api.get("/v1/issues", params={"run_id": run_id}).json()}
        hit, miss, extra = score(case, found)
        caught, missed, false_alarms = caught + len(hit), missed + len(miss), false_alarms + len(extra)
        for t, *_ in hit:
            per_type.setdefault(t, [0, 0, 0])[0] += 1
        for t, *_ in miss:
            per_type.setdefault(t, [0, 0, 0])[1] += 1
        for t, *_ in extra:
            per_type.setdefault(t, [0, 0, 0])[2] += 1
        mark = "PASS" if not miss and not extra else "FAIL"
        print(f"{mark}  {case['name']:<40} caught {len(hit)}/{len(hit) + len(miss)}"
              + (f"  missed {sorted(miss)}" if miss else "") + (f"  false alarms {sorted(extra)}" if extra else ""))
    if a.report:
        total = caught + missed
        print(f"\ncaught {caught} of {total} planted bugs, {false_alarms} false alarms")
        for t, (h, m, x) in sorted(per_type.items()):
            print(f"  {t:<16} caught {h}/{h + m}  false alarms {x}")
    return 0 if missed == 0 and false_alarms == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
