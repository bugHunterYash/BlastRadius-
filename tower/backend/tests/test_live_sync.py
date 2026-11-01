"""Live sync of Claude app sessions and Codex app threads: incremental, idempotent, read-only."""

import claude_agent_sdk
import pytest
from claude_agent_sdk import SDKSessionInfo
from fastapi.testclient import TestClient

from app import live_sync
from tests.test_session_import import AUTH, SID, transcript
from tests.conftest import NO_TOKEN

TID = "019a0000-aaaa-bbbb-cccc-000000000001"


def codex_thread(n_turns: int) -> dict:
    turns = [{"id": "t1", "status": "completed", "items": [
        {"type": "userMessage", "id": "i1", "content": [{"type": "text", "text": "Add a health route"}]},
        {"type": "reasoning", "id": "i2", "summary": ["private"]},
        {"type": "agentMessage", "id": "i3", "text": "Adding /health to api.py."},
        {"type": "commandExecution", "id": "i4", "command": "pytest -q", "cwd": "/w", "status": "completed",
         "exitCode": 0, "aggregatedOutput": "2 passed"},
        {"type": "fileChange", "id": "i5", "status": "completed",
         "changes": [{"path": "api.py", "kind": {"type": "update"}, "diff": "+ /health"}]},
    ]}, {"id": "t2", "status": "completed", "items": [
        {"type": "userMessage", "id": "i6", "content": [{"type": "text", "text": "Now document it"}]},
        {"type": "agentMessage", "id": "i7", "text": "Documented in README."},
    ]}]
    return {"id": TID, "turns": turns[:n_turns]}


def test_normalize_codex_drops_reasoning():
    events, summary = live_sync.normalize_codex(codex_thread(2))
    assert [t for t, _, _ in events] == ["prompt.received", "message.completed", "command.started", "command.completed",
                                         "file.changed", "prompt.received", "message.completed"]
    assert events[2][1] == "Adding /health to api.py." and events[3][2]["output"] == "2 passed"
    assert "private" not in str(events)
    assert summary == {"first_prompt": "Add a health route", "final_response": "Documented in README."}


class FakeConn:
    def __init__(self):
        self.turns, self.updated = 1, 100.0
        import asyncio
        self.notifications = asyncio.Queue()

    async def request(self, method, params, timeout=None):
        if method == "thread/list":
            return {"data": [{"id": TID, "updatedAt": self.updated, "preview": "Add a health route", "cwd": "/w",
                              "source": "vscode"}]}
        assert method == "thread/read" and params == {"threadId": TID, "includeTurns": True}
        return {"thread": codex_thread(self.turns)}


@pytest.fixture
def client(fresh_db, monkeypatch):
    info = SDKSessionInfo(session_id=SID, summary="Login bug fix", last_modified=1793466330850, file_size=1234,
                          custom_title=None, first_prompt="Fix the login bug in auth.py", git_branch="main",
                          cwd="C:/proj", tag=None, created_at=1793466000000)
    msgs = {"n": 2}
    monkeypatch.setattr(claude_agent_sdk, "list_sessions", lambda directory=None, limit=None: [info])
    monkeypatch.setattr(claude_agent_sdk, "get_session_info", lambda sid, directory=None: info if sid == SID else None)
    monkeypatch.setattr(claude_agent_sdk, "get_session_messages",
                        lambda sid, directory=None, limit=None: transcript()[:msgs["n"]])
    conn = FakeConn()

    async def ready():
        return conn
    monkeypatch.setattr(live_sync._codex, "_ready", ready)
    from app.main import app

    with TestClient(app) as c:
        yield c, info, msgs, conn


def test_sync_is_incremental_and_idempotent(client):
    c, info, msgs, conn = client
    assert c.post("/v1/live/sync", headers=NO_TOKEN).status_code == 401
    first = c.post("/v1/live/sync", headers=AUTH).json()["changes"]
    assert {(x["provider"], x["run_id"]) for x in first} == {("claude", f"claude-session-{SID[:8]}"),
                                                             ("codex", f"codex-thread-{TID[:8]}")}
    assert c.post("/v1/live/sync", headers=AUTH).json()["changes"] == []          # nothing new, nothing written

    # both chats move on: only the new steps are appended
    msgs["n"], info.last_modified = 6, info.last_modified + 1000
    conn.turns, conn.updated = 2, 200.0
    more = {x["provider"]: x for x in c.post("/v1/live/sync", headers=AUTH).json()["changes"]}
    assert more["codex"]["new_events"] == 2

    live = c.get("/v1/live/sessions", headers=AUTH).json()
    assert {s["runtime"] for s in live} == {"claude_code_import", "codex_app_import"}
    codex = next(s for s in live if s["provider"] == "codex")
    events = c.get(f"/v1/invocations/{codex['invocation_id']}/events").json()
    kinds = [e["event_type"] for e in events]
    assert kinds[0] == "session.started" and kinds.count("prompt.received") == 2
    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))      # no duplicates
    inv = c.get(f"/v1/invocations/{codex['invocation_id']}").json()
    assert inv["final_response"] == "Documented in README." and inv["routing"]["launched_by_tower"] is False

    claude = next(s for s in live if s["provider"] == "claude")
    assert claude["title"] == "Login bug fix"
    cinv = c.get(f"/v1/invocations/{claude['invocation_id']}").json()
    assert "[REDACTED]" in cinv["final_response"]


def test_hand_imported_session_stays_live(client):
    c, info, msgs, _ = client
    iid = c.post(f"/v1/claude-sessions/{SID}/import", headers=AUTH).json()["invocation_id"]
    msgs["n"], info.last_modified = 6, info.last_modified + 1000
    changes = {x["provider"]: x for x in c.post("/v1/live/sync", headers=AUTH).json()["changes"]}
    assert changes["claude"]["invocation_id"] == iid and changes["claude"]["new_events"] == 9    # 3 -> 12 steps
    events = c.get(f"/v1/invocations/{iid}/events").json()
    assert [e["sequence"] for e in events] == list(range(1, 14))                                 # same as a full import


def test_normalize_rollout_reads_cli_history():
    import json
    rows = [
        {"type": "turn_context", "payload": {"model": "gpt-5.4"}},
        {"type": "response_item", "payload": {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "<permissions>"}]}},
        {"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "UserMessage", "id": "item-1",
                                                                             "content": [{"type": "text", "text": "Fix the hero"}]}}},
        {"type": "response_item", "payload": {"type": "reasoning", "summary": [], "encrypted_content": "secret"}},
        {"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "AgentMessage", "id": "item-2",
                                                                             "content": [{"type": "Text", "text": "Checking the layout first."}]}}},
        {"type": "response_item", "payload": {"type": "function_call", "name": "shell_command", "call_id": "c1",
                                              "arguments": json.dumps({"command": "npm test", "workdir": "/w"})}},
        {"type": "response_item", "payload": {"type": "function_call_output", "call_id": "c1", "output": "Exit code: 1\nOutput:\nfail"}},
        {"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "FileChange", "id": "c2", "status": "completed",
                                                                             "changes": {"/w/hero.tsx": {"type": "update"}}}}},
        {"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 900, "output_tokens": 40}}}},
        "not json",
    ]
    lines = [r if isinstance(r, str) else json.dumps(r) for r in rows]
    events, summary = live_sync.normalize_rollout(lines)
    assert [t for t, _, _ in events] == ["prompt.received", "message.completed", "command.started", "command.completed", "file.changed"]
    assert events[2][1] == "Checking the layout first." and events[3][2]["exit_code"] == 1
    assert "secret" not in str(events) and "<permissions>" not in str(events)
    assert summary["model"] == "gpt-5.4" and summary["usage"] == {"input_tokens": 900, "output_tokens": 40}


def _agy_index(root, status="CASCADE_RUN_STATUS_RUNNING_GENERATOR"):
    import json
    import sqlite3
    root.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(root / "conversation_summaries.db")
    c.execute("CREATE TABLE conversation_summaries (conversation_id text, title text, preview text, step_count integer, "
              "last_modified_time datetime, workspace_uris text, status text, nesting_depth integer)")
    c.execute("CREATE TABLE conversations_fts_content (id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, "
              "c10, c11, c12, c13, c14)")
    c.execute("INSERT INTO conversation_summaries VALUES (?, ?, '', 4, ?, ?, ?, 0)",
              ("agy-1", "Plan the release", "2026-11-01 04:10:00.5+00:00",
               json.dumps(["file:///c%3A/Users/me/Documents/shop%20app"]), status))
    user, agent = "Plan the release\nAlso check पृष्ठ", "Here is the plan.\nDone: release notes drafted."
    first_agent = len("Here is the plan.\n".encode())
    second_user = len("Plan the release\n".encode())
    c.execute("INSERT INTO conversations_fts_content (c0, c1, c8, c9, c13, c14) VALUES ('agy-1', 0, ?, ?, ?, ?)",
              (json.dumps([[0, 0], [2, second_user]]).encode(), json.dumps([[1, 0], [3, first_agent]]).encode(), user, agent))
    c.commit()
    c.close()


def test_antigravity_chats_are_synced(client, monkeypatch, tmp_path):
    from app.config import settings
    c, *_ = client
    _agy_index(tmp_path / "agy")
    monkeypatch.setattr(settings, "ANTIGRAVITY_DIR", str(tmp_path / "agy"))
    changes = {x["provider"]: x for x in c.post("/v1/live/sync", headers=AUTH).json()["changes"]}
    agy = changes["antigravity"]
    # still running: the last reply may still be growing, so it waits
    assert agy["active"] is True and agy["title"] == "Plan the release" and agy["new_events"] == 3

    import sqlite3
    db = sqlite3.connect(tmp_path / "agy" / "conversation_summaries.db")
    db.execute("UPDATE conversation_summaries SET status = 'CASCADE_RUN_STATUS_IDLE', last_modified_time = '2026-11-01 04:11:00+00:00'")
    db.commit()
    db.close()
    agy = next(x for x in c.post("/v1/live/sync", headers=AUTH).json()["changes"] if x["provider"] == "antigravity")
    assert agy["active"] is False and agy["new_events"] == 1

    events = c.get(f"/v1/invocations/{agy['invocation_id']}/events").json()
    assert [(e["event_type"], e["payload"].get("prompt") or e["payload"].get("text")) for e in events[1:]] == [
        ("prompt.received", "Plan the release"), ("message.completed", "Here is the plan."),
        ("prompt.received", "Also check पृष्ठ"), ("message.completed", "Done: release notes drafted.")]
    inv = c.get(f"/v1/invocations/{agy['invocation_id']}").json()
    assert inv["status"] == "completed" and inv["metadata"]["cwd"].endswith("shop app")
    again = c.post("/v1/live/sync", headers=AUTH).json()["changes"]
    assert not [x for x in again if x["provider"] == "antigravity"]               # nothing new, nothing written


def test_project_folder_can_be_added_only_where_a_synced_session_works(client, monkeypatch, tmp_path):
    import json
    import sqlite3
    from app.config import settings
    from app.runtime import router, workspace
    c, *_ = client
    project = tmp_path / "shop app"
    (project / "src").mkdir(parents=True)
    _agy_index(tmp_path / "agy")
    db = sqlite3.connect(tmp_path / "agy" / "conversation_summaries.db")
    db.execute("UPDATE conversation_summaries SET workspace_uris = ?", (json.dumps([(project / "src").as_uri()]),))
    db.commit()
    db.close()
    monkeypatch.setattr(settings, "ANTIGRAVITY_DIR", str(tmp_path / "agy"))

    assert c.post("/v1/projects", json={"path": str(project)}, headers=NO_TOKEN).status_code == 401
    assert c.post("/v1/projects", headers=AUTH, json={"path": str(project)}).status_code == 422   # nothing synced there yet
    c.post("/v1/live/sync", headers=AUTH)
    assert c.post("/v1/projects", headers=AUTH, json={"path": str(tmp_path / "elsewhere")}).status_code == 422
    r = c.post("/v1/projects", headers=AUTH, json={"path": str(project)})
    assert r.status_code == 201 and r.json()["name"] == "shop app"
    wid = r.json()["workspace_id"]
    assert c.post("/v1/projects", headers=AUTH, json={"path": str(project)}).json()["workspace_id"] == wid   # idempotent
    assert [p["workspace_id"] for p in c.get("/v1/projects", headers=AUTH).json()] == [wid]
    assert workspace.resolve(wid) == project.resolve()

    design = {"agents": ["publisher"], "runtimes": {"publisher": {"provider": "codex", "workspace_id": "demo-workspace",
                                                                 "permissions": {"read": True, "write": True, "execute": True}}}}
    route = router.resolve("publisher", design, wid, read_only=True)
    assert route.workspace_path == str(project.resolve()) and route.permissions == {"read": True, "write": False, "execute": False}
    assert route.sandbox == "read-only"


def test_codex_steps_still_running_wait_for_a_later_pass():
    thread = codex_thread(1)
    thread["turns"][0]["status"] = "inProgress"
    thread["turns"][0]["items"][3]["status"] = "inProgress"          # the command is still running
    events, _ = live_sync.normalize_codex(thread)
    assert [t for t, _, _ in events] == ["prompt.received", "message.completed"]
    thread["turns"][0]["items"][3]["status"] = "completed"
    thread["turns"][0]["items"].append({"type": "agentMessage", "id": "i9", "text": "Half a sente"})
    events, _ = live_sync.normalize_codex(thread)
    assert [t for t, _, _ in events][-1] == "file.changed"            # the reply being written waits too


def test_running_session_is_not_read_again_until_it_changes(client, monkeypatch):
    import time
    c, _, _, conn = client
    conn.updated = time.time()                                       # touched just now: running
    reads = []
    real = conn.request

    async def counting(method, params, timeout=None):
        if method == "thread/read":
            reads.append(params["threadId"])
        return await real(method, params, timeout)
    conn.request = counting
    first = {x["provider"]: x for x in c.post("/v1/live/sync", headers=AUTH).json()["changes"]}
    assert first["codex"]["active"] is True and len(reads) == 1
    c.post("/v1/live/sync", headers=AUTH)
    assert len(reads) == 1                                           # unchanged: no second full read

    monkeypatch.setattr(live_sync, "ACTIVE_WINDOW_S", 0)             # the window passes
    c.post("/v1/live/sync", headers=AUTH)
    assert len(reads) == 1
    codex = next(s for s in c.get("/v1/live/sessions", headers=AUTH).json() if s["provider"] == "codex")
    assert codex["status"] == "completed"
