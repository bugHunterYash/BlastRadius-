"""Invocation API, PostgreSQL persistence, SSE, and the full mock end-to-end scenario.

The Codex adapter talks to fake_codex_app_server.py over real stdio JSON-RPC; the Claude adapter gets a
fake client that yields the SDK's own message classes. No credits, no network.
"""

import asyncio
import datetime as dt
import time
import uuid

import pytest
import yaml
from fastapi.testclient import TestClient

from app.runtime import router as agent_router
from app.runtime.claude_sdk import ClaudeRuntime
from app.runtime.codex_app_server import CodexRuntime
from tests.fakes import FAKE_CODEX, FakeClaudeClient

AUTH = {"Authorization": "Bearer test-token"}
RUNTIMES = {
    "researcher": {"provider": "codex", "workspace_id": "demo-workspace",
                   "permissions": {"read": True, "write": True, "execute": True}},
    "writer": {"provider": "claude", "workspace_id": "demo-workspace"},
    "reviewer": {"provider": "claude", "workspace_id": "demo-workspace"},
    "publisher": {"provider": "claude", "workspace_id": "demo-workspace"},
}


@pytest.fixture
def client(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_CODEX_MODE", "ok")
    monkeypatch.setenv("FAKE_CODEX_LOG", str(tmp_path / "codex.log"))
    agent_router.set_runtime(CodexRuntime(argv=FAKE_CODEX))
    agent_router.set_runtime(ClaudeRuntime(client_factory=lambda o: FakeClaudeClient(o)))
    from app.main import app

    with TestClient(app) as c:
        design = c.get("/v1/design").json()
        assert c.put("/v1/design", json={**design, "runtimes": RUNTIMES}).status_code == 200
        yield c
    agent_router._registry.clear()


def invoke(c, agent, run_id="run-x", prompt="Inspect the authentication module", **extra):
    return c.post(f"/v1/agents/{agent}/invoke", headers=AUTH,
                  json={"run_id": run_id, "prompt": prompt, "why": f"{agent} step of the launch", **extra})


def wait_terminal(c, invocation_id, timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        inv = c.get(f"/v1/invocations/{invocation_id}").json()
        if inv["status"] in ("completed", "failed", "cancelled", "timeout") and not inv["running"]:
            return inv
        time.sleep(0.1)
    raise AssertionError("invocation did not finish")


# ---------- API + persistence ----------

def test_invoke_requires_token_and_valid_route(client):
    body = {"run_id": "r", "prompt": "hi"}
    assert client.post("/v1/agents/researcher/invoke", json=body).status_code == 401
    assert client.post("/v1/agents/nobody/invoke", json=body, headers=AUTH).status_code == 404
    bad_ws = client.post("/v1/agents/writer/invoke", json={**body, "workspace_id": "../etc"}, headers=AUTH)
    assert bad_ws.status_code == 422
    assert client.post("/v1/agents/writer/invoke", json={**body, "prompt": "x" * 20_001}, headers=AUTH).status_code == 422


def test_codex_invocation_is_captured_end_to_end(client):
    r = invoke(client, "researcher")
    assert r.status_code == 202 and r.json()["runtime"] == "codex_app_server"
    inv = wait_terminal(client, r.json()["invocation_id"])

    assert inv["status"] == "completed" and inv["user_prompt"] == "Inspect the authentication module"
    assert "You are the researcher agent" in inv["system_prompt"]
    assert inv["final_response"] == "Found 3 problems." and inv["why"] == "researcher step of the launch"
    assert (inv["provider_thread_id"], inv["provider_turn_id"]) == ("thr_test_1", "turn_test_1")
    assert (inv["input_tokens"], inv["output_tokens"]) == (120, 30) and inv["session_id"]
    assert inv["routing"]["sandbox"] == "workspace-write"

    events = client.get(f"/v1/invocations/{inv['invocation_id']}/events").json()
    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))       # ordered, no gaps
    types = [e["event_type"] for e in events]
    assert types[:4] == ["invocation.created", "invocation.started", "prompt.received", "session.started"]
    assert types[-1] == "invocation.completed"
    for t in ("message.delta", "command.started", "command.completed", "file.changed", "approval.requested"):
        assert t in types
    cmd = next(e for e in events if e["event_type"] == "command.started")
    assert cmd["why"] == "I'll inspect auth.py for the login flow."
    done = next(e for e in events if e["event_type"] == "command.completed")
    assert "sk-ant-" not in done["payload"]["output"] and "[REDACTED]" in done["payload"]["output"]

    later = client.get(f"/v1/invocations/{inv['invocation_id']}/events", params={"after_sequence": 10}).json()
    assert [e["sequence"] for e in later] == list(range(11, len(events) + 1))      # replay after reconnect
    only = client.get(f"/v1/invocations/{inv['invocation_id']}/events", params={"types": "agent.file.changed"}).json()
    assert [e["payload"]["path"] for e in only] == ["REVIEW.md"]

    run = client.get("/v1/runs/run-x/invocations").json()
    assert run["summary"]["total_invocations"] == 1 and run["summary"]["completed"] == 1


def test_claude_invocation_and_session_resume(client):
    first = wait_terminal(client, invoke(client, "writer", prompt="Write the post").json()["invocation_id"])
    assert first["provider"] == "claude" and first["final_response"] == "Draft: launch at ₹499."
    assert first["provider_thread_id"] == "sess-claude-1"
    events = client.get(f"/v1/invocations/{first['invocation_id']}/events").json()
    tool = next(e for e in events if e["event_type"] == "tool.started")
    assert tool["payload"]["tool"] == "Read" and tool["why"] == "Let me read the pricing sheet."

    FakeClaudeClient.instances.clear()
    again = invoke(client, "writer", prompt="Shorten it", session_id=first["session_id"]).json()
    wait_terminal(client, again["invocation_id"])
    assert FakeClaudeClient.instances[-1].options.resume == "sess-claude-1"
    wrong = invoke(client, "researcher", session_id=first["session_id"])
    assert wrong.status_code == 404                     # a Claude session can't be resumed on Codex


def test_idempotency_key_returns_the_same_invocation(client):
    a = invoke(client, "writer", idempotency_key="launch-42")
    b = invoke(client, "writer", idempotency_key="launch-42")
    assert (a.status_code, b.status_code) == (202, 200)
    assert a.json()["invocation_id"] == b.json()["invocation_id"]
    wait_terminal(client, a.json()["invocation_id"])


def test_failed_codex_turn_is_recorded(client, monkeypatch):
    monkeypatch.setenv("FAKE_CODEX_MODE", "fail")
    inv = wait_terminal(client, invoke(client, "researcher").json()["invocation_id"])
    assert inv["status"] == "failed" and inv["error_message"] == "model overloaded"
    types = [e["event_type"] for e in client.get(f"/v1/invocations/{inv['invocation_id']}/events").json()]
    assert "execution.error" in types and types[-1] == "invocation.failed"


def test_cancel_stops_codex_and_records_it(client, monkeypatch):
    monkeypatch.setenv("FAKE_CODEX_MODE", "hang")
    iid = invoke(client, "researcher").json()["invocation_id"]
    for _ in range(100):
        types = [e["event_type"] for e in client.get(f"/v1/invocations/{iid}/events").json()]
        if "session.started" in types:
            break
        time.sleep(0.1)
    time.sleep(0.3)
    assert client.post(f"/v1/invocations/{iid}/cancel").status_code == 401
    assert client.post(f"/v1/invocations/{iid}/cancel", headers=AUTH).status_code == 202
    inv = wait_terminal(client, iid)
    assert inv["status"] == "cancelled"
    assert client.get(f"/v1/invocations/{iid}/events").json()[-1]["event_type"] == "invocation.cancelled"
    assert client.post(f"/v1/invocations/{iid}/cancel", headers=AUTH).status_code == 409


def test_disabled_provider_is_rejected_by_the_api(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "CLAUDE_RUNTIME_ENABLED", False)
    assert invoke(client, "writer").status_code == 409
    agents = {a["agent_id"]: a for a in client.get("/v1/agents").json()}
    assert agents["writer"]["routable"] is False and agents["researcher"]["provider"] == "codex"


def test_provider_health_does_real_checks(client):
    h = client.get("/v1/agents/providers/health").json()
    assert h["codex"]["available"] is True and h["codex"]["auth_mode"] == "chatgpt (plus)"   # fake app-server handshake
    assert h["postgres"]["available"] is True
    assert h["meko"]["mode"] == "local" and h["meko"]["available"] is False
    assert "example.com" not in str(h)


# ---------- PostgreSQL ----------

def test_concurrent_appends_get_gap_free_sequences_and_dedupe(client):
    from app import execution_db as xdb

    inv = wait_terminal(client, invoke(client, "writer").json()["invocation_id"])
    base = inv["last_sequence"]

    async def go():
        from app import db
        await db.init()
        try:
            rows = await asyncio.gather(*(xdb.append_event(inv["invocation_id"], "test.event", None, {"i": i})
                                          for i in range(30)))
            dup = await xdb.append_event(inv["invocation_id"], "test.event", None, {}, dedupe_key="prompt")
            with pytest.raises(LookupError):
                await xdb.append_event(str(uuid.uuid4()), "test.event", None, {})
            return sorted(r["sequence"] for r in rows), dup
        finally:
            await db.close()

    seqs, dup = asyncio.run(go())
    assert seqs == list(range(base + 1, base + 31)) and dup is None


# ---------- SSE ----------

def test_broadcaster_fans_out_in_order_and_survives_disconnects():
    from app import stream

    async def go():
        a, b = stream.subscribe(), stream.subscribe()
        first_a, first_b = asyncio.ensure_future(a.__anext__()), asyncio.ensure_future(b.__anext__())
        await asyncio.sleep(0)
        await stream.publish("agent.message.delta", {"sequence": 1})
        await stream.publish("agent.message.delta", {"sequence": 2})
        got_a = [await first_a, await a.__anext__()]
        got_b = await first_b
        await b.aclose()                                   # one client disconnects
        await stream.publish("agent.invocation.completed", {"sequence": 3})
        got_a.append(await asyncio.wait_for(a.__anext__(), 1))
        await a.aclose()
        return got_a, got_b, len(stream._subscribers)

    got_a, got_b, left = asyncio.run(go())
    assert [n for n, _ in got_a] == ["agent.message.delta", "agent.message.delta", "agent.invocation.completed"]
    assert '"sequence": 1' in got_a[0][1] and '"sequence": 3' in got_a[2][1]
    assert got_b[0] == "agent.message.delta" and left == 0


def test_stream_filters_by_run_agent_and_invocation():
    from app.routers.stream import matches
    data = '{"run_id": "r1", "agent_id": "writer", "invocation_id": "i1"}'
    assert matches(data, {}) and matches(data, {"run_id": "r1", "agent_id": "writer"})
    assert not matches(data, {"invocation_id": "i2"})
    assert matches('{"run_id": "r1", "agent": "writer"}', {"agent_id": "writer"})   # memory events say "agent"


# ---------- end to end ----------

class Memory:
    """The tower SDK's memory calls, sent over HTTP like a real agent process would."""

    def __init__(self, c, run_id):
        self.c, self.run_id, self.t = c, run_id, dt.datetime.now(dt.timezone.utc)
        self.emit("system", "run_start", scenario="launch-e2e")

    def emit(self, agent, op, invocation_id=None, **kw):
        self.t += dt.timedelta(milliseconds=50)
        body = {"event_id": str(uuid.uuid4()), "run_id": self.run_id, "agent": agent, "op": op,
                "ts": self.t.isoformat(), "invocation_id": invocation_id, **kw}
        r = self.c.post("/v1/events", json=body, headers=AUTH)
        assert r.status_code == 200, r.text
        return r.json()

    def write(self, agent, key, value, why, inv):
        v = self.emit(agent, "write", inv, fact_key=key, value_preview=value, reason=why)["version"]
        self.c.post("/v1/notebook", json={"text": f"[fact:{key} v{v}] {value}"}, headers=AUTH)
        return v

    def read(self, agent, key, version, why, inv):
        self.emit(agent, "read", inv, fact_key=key, version=version, reason=why)

    def end(self):
        self.emit("system", "run_end")
        for _ in range(150):
            if self.c.get(f"/v1/runs/{self.run_id}").json()["status"] == "done":
                return
            time.sleep(0.1)
        raise AssertionError("run not analysed")


def launch_run(c, run_id, writer_reads_latest: bool):
    m = Memory(c, run_id)
    research = invoke(c, "researcher", run_id=run_id, prompt="Find the launch price in pricing.md").json()
    wait_terminal(c, research["invocation_id"])
    v1 = m.write("researcher", "price", "₹499", "first price from the sheet", research["invocation_id"])
    m.write("researcher", "price", "₹549", "pricing sheet was updated, correcting the price", research["invocation_id"])
    m.emit("researcher", "handoff", research["invocation_id"], target_agent="writer", reason="research done")

    writer = invoke(c, "writer", run_id=run_id, prompt="Write the launch post using the price from memory").json()
    seen = v1 + 1 if writer_reads_latest else v1
    m.read("writer", "price", seen, "price for the post", writer["invocation_id"])
    wait_terminal(c, writer["invocation_id"])
    m.write("writer", "draft", "Launch at ₹499", "draft from Claude's answer", writer["invocation_id"])
    m.emit("writer", "handoff", writer["invocation_id"], target_agent="reviewer")
    m.read("reviewer", "draft", 1 if not writer_reads_latest else 2, "reviewing", None)
    m.write("reviewer", "review", "ok", "review done", None)
    m.emit("reviewer", "handoff", None, target_agent="publisher")
    m.end()
    return research["invocation_id"], writer["invocation_id"]


def test_end_to_end_codex_and_claude_run_detect_fix_approve_verify(client, config_dir):
    research_id, writer_id = launch_run(client, "e2e-1", writer_reads_latest=False)

    issues = client.get("/v1/issues", params={"run_id": "e2e-1"}).json()
    assert [(i["type"], i["agent"], i["fact_key"]) for i in issues] == [("stale_read", "writer", "price")]
    issue = client.get(f"/v1/issues/{issues[0]['issue_id']}").json()
    assert [e["invocation_id"] for e in issue["evidence"]] == [research_id, writer_id]   # memory <-> execution
    assert writer_id in [i["invocation_id"] for i in issue["invocations"]]
    assert issue["fix"]["fix_type"] == "handoff_rule" and issue["fix"]["target_agent"] == "writer"

    digest = client.get("/v1/timeline", params={"run_id": "e2e-1"}).json()["digests"][0]["summary"]
    assert digest["notable"] == [issue["detail"]]                     # detectors, not the LLM
    assert digest["execution_summary"]["total_invocations"] == 2
    assert digest["execution_summary"]["by_provider"] == {"codex": 1, "claude": 1}

    writer_inv = client.get(f"/v1/invocations/{writer_id}").json()
    assert writer_inv["user_prompt"] == "Write the launch post using the price from memory"
    assert writer_inv["final_response"] == "Draft: launch at ₹499."
    assert [(m["op"], m["fact_key"], m["reason"]) for m in writer_inv["memory_events"]][:1] == \
           [("read", "price", "price for the post")]

    r = client.post(f"/v1/fixes/{issue['fix']['fix_id']}/approve", json={"decided_by": "yash"})
    assert r.status_code == 200 and r.json()["meko_ref"].startswith("local:")
    writer_cfg = yaml.safe_load((config_dir / "writer.yaml").read_text(encoding="utf-8"))
    assert "recall latest version" in writer_cfg["handoff_rule"]
    # The approved rule now reaches the runtime: it's part of the next invocation's system prompt.
    next_route = client.get("/v1/agents").json()
    assert next(a for a in next_route if a["agent_id"] == "writer")["routable"]

    launch_run(client, "e2e-2", writer_reads_latest=True)
    assert client.get("/v1/issues", params={"run_id": "e2e-2"}).json() == []
    after = client.get(f"/v1/issues/{issue['issue_id']}").json()
    assert after["status"] == "resolved" and after["note"] == "verified clean in e2e-2"
    rerun_writer = [i for i in client.get("/v1/runs/e2e-2/invocations").json()["invocations"] if i["agent_id"] == "writer"][0]
    assert "recall latest version" in client.get(f"/v1/invocations/{rerun_writer['invocation_id']}").json()["system_prompt"]
    audit = client.get("/v1/audit").json()
    assert audit[0]["decided_by"] == "yash" and audit[0]["decision"] == "approved"


def test_run_invocations_full_returns_whole_prompt_and_answer(client):
    long_prompt = "Explain the pricing. " * 40
    iid = invoke(client, "writer", run_id="chat-x", prompt=long_prompt).json()["invocation_id"]
    wait_terminal(client, iid)
    short = client.get("/v1/runs/chat-x/invocations").json()["invocations"][0]
    full = client.get("/v1/runs/chat-x/invocations", params={"full": "true"}).json()["invocations"][0]
    assert short["user_prompt"] is None and len(short["prompt_preview"]) == 300
    assert full["user_prompt"] == long_prompt and full["final_response"] == "Draft: launch at ₹499."
