"""End-to-end demo: real Codex + Claude agents, shared notebook, detectors, digest, Fixer, approval, rerun.

    python demo-agents/runtime_demo.py --mode live              # researcher on Codex, writer on Claude
    python demo-agents/runtime_demo.py --mode live --approve    # then approve the fixes as "demo" and rerun
    python demo-agents/runtime_demo.py --mode replay            # recorded transcripts, no credentials needed
                                                                # (server needs REPLAY_RUNTIME_ENABLED=true)

The planted bug: the researcher corrects the price (Rs. 499 -> Rs. 549) in the notebook, but the writer
keeps the version it saw first, unless its handoff rule tells it to recall the latest version. The
detectors catch the stale read from the notebook events; the invocations show what each agent was
asked and what it answered. Live mode never pretends: a failed provider call is shown as failed.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "sdk-python"))
sys.path.insert(0, str(HERE))

import tower  # noqa: E402
from team import reads_latest  # noqa: E402

SCENARIO = "runtime-launch"


class Tower:
    def __init__(self, api_url: str):
        token = os.environ.get("TOWER_API_TOKEN") or os.environ.get("TOWER_INGEST_TOKEN", "dev-ingest-token-change-me")
        self.http = httpx.Client(base_url=api_url, headers={"Authorization": f"Bearer {token}"}, timeout=30)

    def use_design(self, mode: str) -> None:
        design = json.loads((HERE.parent / "design" / "design.json").read_text(encoding="utf-8"))
        if mode == "replay":
            for rt in design["runtimes"].values():
                rt.update(provider="replay", runtime="replay", model=None)
        self.http.put("/v1/design", json=design).raise_for_status()

    def invoke(self, agent: str, run_id: str, prompt: str, why: str) -> dict:
        r = self.http.post(f"/v1/agents/{agent}/invoke", json={"run_id": run_id, "prompt": prompt, "why": why})
        if r.status_code >= 300:
            raise SystemExit(f"{agent}: invoke refused ({r.status_code}): {r.text}")
        iid = r.json()["invocation_id"]
        print(f"  {agent:<10} -> {r.json()['provider']}/{r.json()['runtime']}  invocation {iid}")
        while True:
            inv = self.http.get(f"/v1/invocations/{iid}").json()
            if inv["status"] not in ("queued", "running") and not inv["running"]:
                break
            time.sleep(1.5)
        answer = (inv["final_response"] or "").replace("\n", " ")[:100]
        print(f"  {'':<10}    {inv['status']}: {answer or inv['error_message']}")
        return inv

    def wait_analysed(self, run_id: str) -> None:
        for _ in range(200):
            if self.http.get(f"/v1/runs/{run_id}").json()["status"] in ("done", "error"):
                return
            time.sleep(1)


def run_once(t: Tower, run_id: str) -> None:
    print(f"\nrun {run_id}")
    with tower.run(run_id, scenario=SCENARIO):
        research = t.invoke("researcher", run_id,
                            "Read pricing.md and reply with only the old price and the current price of the "
                            "Aqua bottle, as 'old -> current'. Do not modify any files.",
                            "Find the launch price for the post")
        with tower.as_agent("researcher", research["invocation_id"]):
            v1 = tower.remember("price", "Rs. 499", why="first price on the sheet")
            tower.remember("price", "Rs. 549", why=f"sheet was updated; researcher answered: {research['final_response'] or 'n/a'}"[:200])
            tower.handoff("writer", why="price research done")

        # The writer's handoff rule (demo-agents/config/writer.yaml) decides which price it uses.
        with tower.as_agent("writer"):
            price = (tower.recall("price", why="re-checking the latest price before writing") if reads_latest("writer")
                     else tower.recall("price", version=v1, why="using the price from my notes"))
        writer = t.invoke("writer", run_id,
                          f"Write a two-sentence launch post for the Aqua bottle at {price}. "
                          "You may read pricing.md but do not modify any files.",
                          "Draft the launch post")
        with tower.as_agent("writer", writer["invocation_id"]):
            tower.remember("draft", writer["final_response"] or f"(writer failed: {writer['error_message']})",
                           why="the writer agent's answer")
            tower.handoff("reviewer", why="draft ready")
        with tower.as_agent("reviewer"):
            tower.recall("draft", why="reviewing the draft")
            tower.remember("review", "approved", why="review result")
            tower.handoff("publisher", why="review finished")
        with tower.as_agent("publisher"):
            draft = tower.recall("draft", why="the post to publish")
            tower.recall("review", why="checking the verdict")
            tower.remember("published", draft, why="published the post")
    t.wait_analysed(run_id)

    issues = t.http.get("/v1/issues", params={"run_id": run_id}).json()
    print(f"  issues: {len(issues)}")
    for i in issues:
        fix = i.get("fix") or {}
        print(f"   - [{i['status']}] {i['type']} {i['agent']}/{i['fact_key']}: {i['detail']}")
        if fix:
            print(f"     fix ({fix['model']}): {fix['fix_type']} on {fix['target_agent']} -> {fix['after']!r}")
    digests = t.http.get("/v1/timeline", params={"run_id": run_id}).json()["digests"]
    if digests:
        d = digests[0]
        print(f"  digest ({d['model']}): {d['summary']['headline']}")
        print(f"  execution: {d['summary'].get('execution_summary')}")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["live", "replay"], default="live")
    p.add_argument("--approve", action="store_true", help="approve all ready fixes, then rerun to verify")
    p.add_argument("--api", default=os.environ.get("TOWER_API_URL", "http://localhost:8000"))
    a = p.parse_args()

    t = Tower(a.api)
    t.use_design(a.mode)
    tower.init(api_url=a.api)
    stamp = time.strftime("%H%M%S")
    first = f"{a.mode}-{stamp}-a"
    run_once(t, first)
    if a.approve:
        for i in t.http.get("/v1/issues", params={"run_id": first, "status": "fix_ready"}).json():
            r = t.http.post(f"/v1/fixes/{i['fix']['fix_id']}/approve", json={"decided_by": "demo"})
            print(f"  approved {i['type']} fix -> {r.status_code}")
        run_once(t, f"{a.mode}-{stamp}-b")
        for i in t.http.get("/v1/issues", params={"run_id": first}).json():
            print(f"  original {i['type']}: {i['status']} ({i['note']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
