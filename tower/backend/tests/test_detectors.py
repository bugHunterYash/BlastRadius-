"""Each detector: at least one "must fire" and one "must stay silent" case. No database, no LLM."""

import datetime as dt
import json

from app.config import settings
from app.detectors import conflict, permission_leak, skipped_handoff, stale_read
from app.models import Ev

DESIGN = json.loads(settings.DESIGN_PATH.read_text(encoding="utf-8"))
T0 = dt.datetime(2026, 10, 31, 17, 0, tzinfo=dt.timezone.utc)


def evs(*steps) -> list[Ev]:
    """steps: (agent, op, fact_or_target, version)"""
    out = []
    for i, (agent, op, what, version) in enumerate(steps):
        fact, target = (None, what) if op == "handoff" else (what, None)
        out.append(Ev(f"e{i}", "run", agent, op, fact, version, None, target, T0 + dt.timedelta(seconds=i)))
    return out


def kinds(drafts):
    return [(d.type, d.agent, d.fact_key) for d in drafts]


# ---------- stale_read ----------

def test_stale_read_fires_on_old_version():
    e = evs(("researcher", "write", "price", 1), ("researcher", "write", "price", 2), ("writer", "read", "price", 1))
    drafts = stale_read(e, DESIGN, {})
    assert kinds(drafts) == [("stale_read", "writer", "price")]
    assert drafts[0].evidence == ["e1", "e2"]


def test_stale_read_uses_versions_from_before_the_run():
    e = evs(("writer", "read", "price", 3))
    assert kinds(stale_read(e, DESIGN, {"price": 4})) == [("stale_read", "writer", "price")]


def test_stale_read_silent_on_latest():
    e = evs(("researcher", "write", "price", 1), ("researcher", "write", "price", 2), ("writer", "read", "price", 2))
    assert stale_read(e, DESIGN, {}) == []


def test_stale_read_silent_when_read_came_before_the_update():
    e = evs(("researcher", "write", "price", 1), ("writer", "read", "price", 1), ("researcher", "write", "price", 2))
    assert stale_read(e, DESIGN, {}) == []


# ---------- conflict ----------

def test_conflict_fires_on_blind_overwrite():
    e = evs(("researcher", "write", "price", 1), ("writer", "write", "price", 2))
    drafts = conflict(e, DESIGN)
    assert kinds(drafts) == [("conflict", "writer", "price")]
    assert drafts[0].evidence == ["e0", "e1"]


def test_conflict_silent_when_second_writer_read_first():
    e = evs(("researcher", "write", "price", 1), ("writer", "read", "price", 1), ("writer", "write", "price", 2))
    assert conflict(e, DESIGN) == []


def test_conflict_silent_for_same_agent_rewrites():
    e = evs(("researcher", "write", "price", 1), ("researcher", "write", "price", 2))
    assert conflict(e, DESIGN) == []


def test_conflict_fires_when_writer_read_an_older_version():
    e = evs(("researcher", "write", "price", 1), ("writer", "read", "price", 1),
            ("researcher", "write", "price", 2), ("writer", "write", "price", 3))
    assert kinds(conflict(e, DESIGN)) == [("conflict", "writer", "price")]


# ---------- skipped_handoff ----------

FULL_CHAIN = [
    ("researcher", "write", "price", 1), ("researcher", "handoff", "writer", None),
    ("writer", "read", "price", 1), ("writer", "write", "draft", 1), ("writer", "handoff", "reviewer", None),
    ("reviewer", "read", "draft", 1), ("reviewer", "write", "review", 1), ("reviewer", "handoff", "publisher", None),
    ("publisher", "read", "draft", 1), ("publisher", "write", "published", 1),
]


def test_skipped_handoff_silent_on_full_chain():
    assert skipped_handoff(evs(*FULL_CHAIN), DESIGN) == []


def test_skipped_handoff_fires_when_reviewer_is_bypassed():
    e = evs(("researcher", "write", "price", 1), ("researcher", "handoff", "writer", None),
            ("writer", "write", "draft", 1), ("writer", "handoff", "publisher", None),
            ("publisher", "write", "published", 1))
    drafts = skipped_handoff(e, DESIGN)
    assert kinds(drafts) == [("skipped_handoff", "publisher", "published")]
    assert drafts[0].evidence == ["e4", "e3"]  # the write, then the wrong handoff it came from
    assert "reviewer" in drafts[0].detail


def test_skipped_handoff_fires_without_any_handoff():
    e = evs(("researcher", "write", "price", 1), ("writer", "write", "draft", 1))
    assert kinds(skipped_handoff(e, DESIGN)) == [("skipped_handoff", "writer", "draft")]


def test_skipped_handoff_reports_an_agent_once_per_run():
    e = evs(("writer", "write", "draft", 1), ("writer", "write", "draft", 2))
    assert len(skipped_handoff(e, DESIGN)) == 1


# ---------- permission_leak ----------

def test_permission_leak_fires_on_forbidden_read():
    e = evs(("publisher", "read", "facts", 1))
    assert kinds(permission_leak(e, DESIGN)) == [("permission_leak", "publisher", "facts")]


def test_permission_leak_fires_on_forbidden_write():
    e = evs(("writer", "write", "price", 1))
    assert kinds(permission_leak(e, DESIGN)) == [("permission_leak", "writer", "price")]


def test_permission_leak_fires_for_unknown_agent():
    e = evs(("intern", "read", "draft", 1))
    assert kinds(permission_leak(e, DESIGN)) == [("permission_leak", "intern", "draft")]


def test_permission_leak_silent_on_full_chain():
    assert permission_leak(evs(*FULL_CHAIN), DESIGN) == []
