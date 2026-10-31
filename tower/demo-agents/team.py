"""Demo content team: researcher -> writer -> reviewer -> publisher, sharing one notebook.

    python demo-agents/team.py            # one run of the "content-launch" scenario
    python demo-agents/team.py --reset    # restore the shipped configs (with their 3 planted bugs)

These are scripted agents: what they do is read from demo-agents/config/<agent>.yaml, so an
approved fix really changes the next run. Shipped configs contain three coordination bugs:
  1. writer re-reads the price from its own earlier notes, so it misses the researcher's correction
  2. writer routes straight to publisher, skipping the reviewer
  3. publisher "double-checks facts", which it isn't allowed to read
An LLM can replace the text generation in each step without changing the memory calls.
"""

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "sdk-python"))

import tower  # noqa: E402

AGENTS = ["researcher", "writer", "reviewer", "publisher"]
SCENARIO = "content-launch"


def cfg(agent: str) -> dict:
    return yaml.safe_load((HERE / "config" / f"{agent}.yaml").read_text(encoding="utf-8"))


def route(agent: str) -> str | None:
    """The agent named in the routing text, if any ("hand off to reviewer" -> reviewer)."""
    text = cfg(agent).get("routing", "").lower()
    found = [(text.find(a), a) for a in AGENTS if a != agent and a in text]
    return min(found)[1] if found else None


def reads_latest(agent: str) -> bool:
    c = cfg(agent)
    return "latest" in (c.get("handoff_rule", "") + " " + c.get("prompt", "")).lower()


def stays_in_bounds(agent: str) -> bool:
    p = cfg(agent).get("prompt", "").lower()
    return "only" in p and ("allowed" in p or "permitted" in p)


def researcher(state):
    tower.remember("price", "₹499", why="launch price from the pricing sheet")
    tower.remember("facts", "Ships in 3 colours; 2-year warranty; launches 15 Nov", why="key facts for the post")
    tower.handoff(route("researcher"), why="research done, ready for a draft")


def writer(state):
    _, first_seen = tower.recall_versioned("price", why="need the price for the post")
    facts = tower.recall("facts", why="need facts for the post")
    # Planted timing: the researcher corrects the price while the writer is still drafting.
    with tower.as_agent("researcher"):
        tower.remember("price", "₹549", why="pricing sheet was updated, correcting the price")
    if reads_latest("writer"):
        price = tower.recall("price", why="re-checking the latest price before writing")
    else:  # re-reads its own earlier notes
        price = tower.recall("price", version=first_seen, why="using the price from my notes")
    tower.remember("draft", f"Launch post: our new bottle is here at {price}. {facts}.", why="first draft of the post")
    tower.handoff(route("writer"), why="draft ready")


def reviewer(state):
    draft = tower.recall("draft", why="reviewing the draft")
    price = tower.recall("price", why="checking the draft's price")
    verdict = "approved" if price in draft else f"needs change: price should be {price}"
    tower.remember("review", f"Review: {verdict}", why="review result")
    tower.handoff(route("reviewer"), why="review finished")


def publisher(state):
    draft = tower.recall("draft", why="the post to publish")
    try:
        tower.recall("review", why="checking the review verdict")
    except tower.MemoryNotFound:
        pass
    if "double-check facts" in cfg("publisher").get("prompt", "").lower() and not stays_in_bounds("publisher"):
        tower.recall("facts", why="my prompt says to double-check facts")
    tower.remember("published", draft, why="published the post")


STEPS = {"researcher": researcher, "writer": writer, "reviewer": reviewer, "publisher": publisher}


def run_team(run_id: str | None = None) -> str:
    with tower.run(run_id, scenario=SCENARIO) as rid:
        current, state, seen = "researcher", {}, set()
        while current and current not in seen:
            seen.add(current)
            with tower.as_agent(current):
                STEPS[current](state)
            current = route(current)
            time.sleep(0.05)  # keeps timestamps readable in the timeline
    return rid


def reset() -> None:
    for f in (HERE / "config.defaults").glob("*.yaml"):
        shutil.copy(f, HERE / "config" / f.name)
    print("configs restored (3 planted bugs are back)")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default=os.environ.get("TOWER_API_URL", "http://localhost:8000"))
    p.add_argument("--run-id")
    p.add_argument("--reset", action="store_true")
    a = p.parse_args()
    if a.reset:
        reset()
        return 0
    tower.init(api_url=a.api, datapack=os.environ.get("MEKO_DATAPACK", "content-team"))
    rid = run_team(a.run_id or f"demo-{time.strftime('%H%M%S')}")
    print(f"run {rid} finished; the control tower is analysing it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
