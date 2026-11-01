"""Importing local Claude Code sessions: normalization, API, idempotency, privacy."""

import claude_agent_sdk
import pytest
from claude_agent_sdk import SDKSessionInfo, SessionMessage
from fastapi.testclient import TestClient

from app.session_import import normalize
from tests.conftest import NO_TOKEN

AUTH = {"Authorization": "Bearer test-token"}
SID = "11111111-2222-3333-4444-555555555555"


def transcript() -> list[SessionMessage]:
    def m(kind, content, **extra):
        return SessionMessage(type=kind, uuid=f"u{len(content) if isinstance(content, str) else id(content)}",
                              session_id=SID, message={"role": kind, "content": content, **extra},
                              parent_tool_use_id=None)
    return [
        m("user", "Fix the login bug in auth.py"),
        m("assistant", [{"type": "thinking", "thinking": "secret plan"},
                        {"type": "text", "text": "I'll look at auth.py first."},
                        {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "auth.py"}}],
          model="claude-test", usage={"input_tokens": 100, "output_tokens": 20}),
        m("user", [{"type": "tool_result", "tool_use_id": "t1", "content": "def login(): ..."}]),
        m("assistant", [{"type": "tool_use", "id": "t2", "name": "Edit",
                         "input": {"file_path": "auth.py", "old_string": "a", "new_string": "b"}},
                        {"type": "tool_use", "id": "t3", "name": "Bash",
                         "input": {"command": "pytest -q", "description": "Run the tests"}}],
          model="claude-test", usage={"input_tokens": 50, "output_tokens": 10}),
        m("user", [{"type": "tool_result", "tool_use_id": "t2", "content": "ok"},
                   {"type": "tool_result", "tool_use_id": "t3", "content": [{"type": "text", "text": "3 passed"}]}]),
        m("assistant", [{"type": "text", "text": "Fixed: compare_digest now. token sk-ant-abcdefghijklmnopqrstuvwxyz"}],
          model="claude-test", usage={"input_tokens": 10, "output_tokens": 5}),
    ]


def test_normalize_matches_live_capture_rules():
    events, summary = normalize(transcript())
    assert [t for t, _, _ in events] == ["prompt.received", "message.completed", "tool.started", "tool.completed",
                                         "tool.started", "tool.started", "command.started", "tool.completed",
                                         "file.changed", "tool.completed", "command.completed", "message.completed"]
    read = events[2]
    assert read[1] == "I'll look at auth.py first." and read[2]["why_source"] == "preceding_assistant_text"
    bash = events[6]
    assert bash[1] == "Run the tests" and bash[2]["command"] == "pytest -q"
    assert events[8][2] == {"tool": "Edit", "path": "auth.py"}
    assert events[10][2]["output"] == "3 passed"
    assert "secret plan" not in str(events)                             # thinking never stored
    assert summary["first_prompt"] == "Fix the login bug in auth.py"
    assert summary["usage"] == {"input_tokens": 160, "output_tokens": 35} and summary["model"] == "claude-test"


@pytest.fixture
def client(fresh_db, monkeypatch):
    info = SDKSessionInfo(session_id=SID, summary="Login bug fix", last_modified=1793466330850, file_size=1234,
                          custom_title=None, first_prompt="Fix the login bug in auth.py", git_branch="main",
                          cwd="C:/proj", tag=None, created_at=1793466000000)
    monkeypatch.setattr(claude_agent_sdk, "list_sessions", lambda directory=None, limit=None: [info])
    monkeypatch.setattr(claude_agent_sdk, "get_session_info", lambda sid, directory=None: info if sid == SID else None)
    monkeypatch.setattr(claude_agent_sdk, "get_session_messages",
                        lambda sid, directory=None, limit=None: transcript())
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_list_and_import_local_session(client):
    assert client.get("/v1/claude-sessions", headers=NO_TOKEN).status_code == 401           # private titles/prompts need the token
    sessions = client.get("/v1/claude-sessions", headers=AUTH).json()
    assert sessions[0]["session_id"] == SID and sessions[0]["title"] == "Login bug fix"

    r = client.post(f"/v1/claude-sessions/{SID}/import", headers=AUTH)
    assert r.status_code == 201 and r.json()["runtime"] == "claude_code_import"
    iid = r.json()["invocation_id"]
    inv = client.get(f"/v1/invocations/{iid}").json()
    assert inv["user_prompt"] == "Fix the login bug in auth.py" and inv["provider_thread_id"] == SID
    assert inv["status"] == "completed" and inv["routing"]["launched_by_tower"] is False
    assert "sk-ant-" not in inv["final_response"] and "[REDACTED]" in inv["final_response"]
    assert (inv["input_tokens"], inv["output_tokens"]) == (160, 35)

    events = client.get(f"/v1/invocations/{iid}/events").json()
    assert [e["sequence"] for e in events] == list(range(1, 14))
    assert events[0]["event_type"] == "session.started" and events[0]["payload"]["imported"] is True

    again = client.post(f"/v1/claude-sessions/{SID}/import", headers=AUTH)
    assert again.status_code == 200 and again.json()["invocation_id"] == iid      # idempotent
    run = client.get(f"/v1/runs/claude-session-{SID[:8]}/invocations").json()
    assert run["summary"]["total_invocations"] == 1


def test_unknown_session_is_404(client):
    assert client.post("/v1/claude-sessions/nope/import", headers=AUTH).status_code == 404
