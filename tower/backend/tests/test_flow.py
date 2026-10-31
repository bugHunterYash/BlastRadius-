"""The whole loop through the HTTP API: ingest -> detectors -> digest -> fix -> approve -> rerun verifies.

LLMs are off, so the Summarizer falls back to a counted digest and the Fixer uses templates.
"""

import datetime as dt
import time
import uuid

import pytest
import yaml
from fastapi.testclient import TestClient

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def client(fresh_db):
    from app.main import app

    with TestClient(app) as c:
        yield c


class Run:
    def __init__(self, client, run_id, scenario="content-launch"):
        self.c, self.run_id, self.t = client, run_id, dt.datetime.now(dt.timezone.utc)
        self.emit("system", "run_start", scenario=scenario)

    def emit(self, agent, op, **kw):
        self.t += dt.timedelta(seconds=1)
        body = {"event_id": str(uuid.uuid4()), "run_id": self.run_id, "agent": agent, "op": op,
                "ts": self.t.isoformat(), **kw}
        r = self.c.post("/v1/events", json=body, headers=AUTH)
        assert r.status_code == 200, r.text
        return r.json()

    def write(self, agent, key, value="x"):
        v = self.emit(agent, "write", fact_key=key, value_preview=value)["version"]
        self.c.post("/v1/notebook", json={"text": f"[fact:{key} v{v}] {value}"}, headers=AUTH)
        return v

    def read(self, agent, key, version):
        return self.emit(agent, "read", fact_key=key, version=version)

    def handoff(self, agent, to):
        return self.emit(agent, "handoff", target_agent=to)

    def end(self):
        self.emit("system", "run_end")
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            status = self.c.get(f"/v1/runs/{self.run_id}").json()["status"]
            if status in ("done", "error"):
                assert status == "done"
                return
            time.sleep(0.1)
        raise AssertionError("run was not analysed in time")


def buggy_run(client, run_id):
    """The shipped demo team: stale price, skipped reviewer, publisher reading facts."""
    r = Run(client, run_id)
    v1 = r.write("researcher", "price", "₹499")
    vf = r.write("researcher", "facts", "2-year warranty")
    r.handoff("researcher", "writer")
    r.read("writer", "price", v1)
    r.read("writer", "facts", vf)
    r.write("researcher", "price", "₹549")
    r.read("writer", "price", v1)
    vd = r.write("writer", "draft", "Launch at ₹499")
    r.handoff("writer", "publisher")
    r.read("publisher", "draft", vd)
    r.read("publisher", "facts", vf)
    r.write("publisher", "published", "Launch at ₹499")
    r.end()


def clean_run(client, run_id):
    r = Run(client, run_id)
    r.write("researcher", "price", "₹499")
    r.write("researcher", "facts", "2-year warranty")
    r.handoff("researcher", "writer")
    v2 = r.write("researcher", "price", "₹549")
    r.read("writer", "price", v2)
    vd = r.write("writer", "draft", "Launch at ₹549")
    r.handoff("writer", "reviewer")
    r.read("reviewer", "draft", vd)
    r.write("reviewer", "review", "ok")
    r.handoff("reviewer", "publisher")
    r.read("publisher", "draft", vd)
    r.write("publisher", "published", "Launch at ₹549")
    r.end()


def test_ingest_needs_the_token(client):
    body = {"event_id": str(uuid.uuid4()), "run_id": "x", "agent": "a", "op": "run_start",
            "ts": dt.datetime.now(dt.timezone.utc).isoformat()}
    assert client.post("/v1/events", json=body).status_code == 401
    assert client.post("/v1/events", json=body, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_read_without_fact_key_is_rejected(client):
    body = {"event_id": str(uuid.uuid4()), "run_id": "x", "agent": "a", "op": "read",
            "ts": dt.datetime.now(dt.timezone.utc).isoformat()}
    assert client.post("/v1/events", json=body, headers=AUTH).status_code == 422


def test_buggy_run_raises_three_issues_with_fixes(client):
    buggy_run(client, "run-1")
    issues = client.get("/v1/issues", params={"run_id": "run-1"}).json()
    found = sorted((i["type"], i["agent"], i["fact_key"]) for i in issues)
    assert found == [("permission_leak", "publisher", "facts"),
                     ("skipped_handoff", "publisher", "published"),
                     ("stale_read", "writer", "price")]
    assert all(i["status"] == "fix_ready" and i["fix"]["model"] == "template" for i in issues)

    stale = next(i for i in issues if i["type"] == "stale_read")
    detail = client.get(f"/v1/issues/{stale['issue_id']}").json()
    assert [(e["agent"], e["op"]) for e in detail["evidence"]] == [("researcher", "write"), ("writer", "read")]
    skip = next(i for i in issues if i["type"] == "skipped_handoff")
    assert (skip["fix"]["fix_type"], skip["fix"]["target_agent"], skip["fix"]["after"]) == \
           ("routing", "writer", "hand off to reviewer")

    tl = client.get("/v1/timeline", params={"run_id": "run-1"}).json()
    assert tl["digests"][0]["model"] == "fallback" and "writes" in tl["digests"][0]["summary"]["headline"]
    runs = client.get("/v1/runs").json()
    assert runs[0]["run_id"] == "run-1" and runs[0]["issues"] == 3


def test_reanalysing_does_not_duplicate_issues(client):
    buggy_run(client, "run-1")
    client.post("/v1/runs/run-1/analyse")
    time.sleep(1)
    assert len(client.get("/v1/issues", params={"run_id": "run-1"}).json()) == 3


def test_approve_changes_config_writes_notebook_and_verifies_on_rerun(client, config_dir):
    buggy_run(client, "run-1")
    issues = client.get("/v1/issues", params={"run_id": "run-1"}).json()
    for i in issues:
        r = client.post(f"/v1/fixes/{i['fix']['fix_id']}/approve", json={"decided_by": "riya"})
        assert r.status_code == 200, r.text
        assert r.json()["meko_ref"].startswith("local:")

    writer = yaml.safe_load((config_dir / "writer.yaml").read_text(encoding="utf-8"))
    assert writer["routing"] == "hand off to reviewer"
    assert "recall latest version" in writer["handoff_rule"]
    publisher = yaml.safe_load((config_dir / "publisher.yaml").read_text(encoding="utf-8"))
    assert "Only read memory keys you are allowed to" in publisher["prompt"]

    again = client.post(f"/v1/fixes/{issues[0]['fix']['fix_id']}/approve", json={"decided_by": "riya"})
    assert again.status_code == 409

    notes = client.get("/v1/notebook", params={"q": "[approval"}).json()
    assert len(notes) == 3 and all("approved by riya" in n["text"] for n in notes)
    audit = client.get("/v1/audit").json()
    assert len(audit) == 3 and {a["decision"] for a in audit} == {"approved"}

    clean_run(client, "run-2")
    assert client.get("/v1/issues", params={"run_id": "run-2"}).json() == []
    after = client.get("/v1/issues", params={"run_id": "run-1"}).json()
    assert {i["status"] for i in after} == {"resolved"}
    assert all("verified clean in run-2" in i["note"] for i in after)


def test_rejected_fix_is_recorded_without_changing_config(client, config_dir):
    buggy_run(client, "run-1")
    before = (config_dir / "writer.yaml").read_text(encoding="utf-8")
    skip = next(i for i in client.get("/v1/issues").json() if i["type"] == "skipped_handoff")
    r = client.post(f"/v1/fixes/{skip['fix']['fix_id']}/reject", json={"decided_by": "riya", "note": "not now"})
    assert r.status_code == 200 and r.json()["decision"] == "rejected"
    assert (config_dir / "writer.yaml").read_text(encoding="utf-8") == before
    assert client.get(f"/v1/issues/{skip['issue_id']}").json()["status"] == "rejected"


def test_fix_reopens_when_it_does_not_hold(client):
    buggy_run(client, "run-1")
    stale = next(i for i in client.get("/v1/issues").json() if i["type"] == "stale_read")
    client.post(f"/v1/fixes/{stale['fix']['fix_id']}/approve", json={"decided_by": "riya"})
    buggy_run(client, "run-2")  # the agents ignored the fix
    reopened = client.get(f"/v1/issues/{stale['issue_id']}").json()
    assert reopened["status"] == "open" and "did not hold" in reopened["note"]


def test_blast_radius_follows_a_write_through_readers(client):
    buggy_run(client, "run-1")
    events = client.get("/v1/runs/run-1/events").json()
    first_price = next(e for e in events if e["op"] == "write" and e["fact_key"] == "price")
    blast = client.get("/v1/blast-radius", params={"event_id": first_price["event_id"]}).json()
    hops = {(n["agent"], n["op"], n["fact_key"]): n["hop"] for n in blast["nodes"]}
    assert hops[("researcher", "write", "price")] == 0
    assert hops[("writer", "read", "price")] == 1
    assert hops[("writer", "write", "draft")] == 1
    assert hops[("publisher", "read", "draft")] == 2
    assert hops[("publisher", "write", "published")] == 2
    assert client.get("/v1/blast-radius", params={"event_id": str(uuid.uuid4())}).status_code == 404


def test_timeline_ask_falls_back_and_says_no_changes(client):
    buggy_run(client, "run-1")
    r = client.post("/v1/timeline/ask", json={"question": "what did the writer change?", "agent": "writer"}).json()
    assert r["model"] == "fallback" and r["rows"] > 0
    none = client.post("/v1/timeline/ask", json={"question": "anything?", "agent": "nobody"}).json()
    assert none["answer"] == "No changes match that filter."


def test_design_put_validates_agents(client):
    bad = {"agents": ["a"], "handoffs": [["a", "b"]]}
    assert client.put("/v1/design", json=bad).status_code == 422
    good = {"agents": ["a", "b"], "handoffs": [["a", "b"]], "permissions": {"a": {"read": [], "write": ["x"]}}}
    assert client.put("/v1/design", json=good).status_code == 200
    assert client.get("/v1/design").json()["agents"] == ["a", "b"]


def test_health_reports_stand_ins(client):
    assert client.get("/v1/health").json() == {"db": True, "notebook": "local", "summarizer": "fallback",
                                               "fixer": "template"}
