"""Router, Claude adapter and Codex adapter, without a database or any live provider."""

import asyncio
import json
import os
import uuid

import pytest

from app.config import settings
from app.runtime import router, workspace
from app.runtime.claude_sdk import ClaudeRuntime, make_permission_check
from app.runtime.codex_app_server import CodexRuntime, JsonRpcConnection
from app.runtime.models import RuntimeRequest
from app.runtime.redact import redact, redact_text
from tests.fakes import FAKE_CODEX, FakeClaudeClient

DESIGN = {
    "agents": ["researcher", "writer", "ghost"],
    "runtimes": {
        "researcher": {"provider": "codex", "workspace_id": "demo-workspace",
                       "permissions": {"read": True, "write": True, "execute": True}},
        "writer": {"provider": "claude", "workspace_id": "demo-workspace", "model": "claude-test-model"},
    },
}


def request_for(agent: str, prompt: str = "Review auth.py", design=DESIGN) -> RuntimeRequest:
    route = router.resolve(agent, design)
    return RuntimeRequest(invocation_id=uuid.uuid4(), run_id="run-t", agent_id=agent, prompt=prompt, why="test", route=route)


class Sink:
    def __init__(self):
        self.events = []

    async def __call__(self, ev):
        self.events.append(ev)

    def types(self):
        return [e.event_type for e in self.events]

    def first(self, t):
        return next(e for e in self.events if e.event_type == t)


# ---------- router ----------

def test_codex_agent_routes_to_codex_app_server():
    r = router.resolve("researcher", DESIGN)
    assert (r.provider, r.runtime, r.sandbox) == ("codex", "codex_app_server", "workspace-write")
    assert r.allowed_tools == ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]
    assert r.workspace_path == str(workspace.resolve("demo-workspace"))


def test_claude_agent_routes_to_claude_sdk_with_least_privilege():
    r = router.resolve("writer", DESIGN)
    assert (r.provider, r.runtime, r.model) == ("claude", "claude_agent_sdk", "claude-test-model")
    assert r.allowed_tools == ["Read", "Glob", "Grep"] and r.sandbox == "read-only"
    assert "You are the writer agent" in r.system_prompt  # application-owned prompt from config


def test_unknown_agent_and_agent_without_runtime():
    with pytest.raises(router.RoutingError) as e:
        router.resolve("nobody", DESIGN)
    assert e.value.status == 404
    with pytest.raises(router.RoutingError) as e:
        router.resolve("ghost", DESIGN)
    assert e.value.status == 422


def test_disabled_provider_and_disabled_agent(monkeypatch):
    monkeypatch.setattr(settings, "CODEX_RUNTIME_ENABLED", False)
    with pytest.raises(router.RoutingError) as e:
        router.resolve("researcher", DESIGN)
    assert e.value.status == 409
    off = {**DESIGN, "runtimes": {**DESIGN["runtimes"], "writer": {**DESIGN["runtimes"]["writer"], "enabled": False}}}
    with pytest.raises(router.RoutingError) as e:
        router.resolve("writer", off)
    assert e.value.status == 409


@pytest.mark.parametrize("ws", ["../etc", "missing-workspace", "Demo Workspace", ""])
def test_invalid_workspace_is_rejected(ws):
    with pytest.raises(router.RoutingError) as e:
        router.resolve("writer", DESIGN, workspace_override=ws or "..")
    assert e.value.status == 422


def test_symlink_escaping_the_root_is_rejected(workspaces, tmp_path):
    link = workspaces / "sneaky"
    try:
        os.symlink(tmp_path, link, target_is_directory=True)
    except OSError:
        pytest.skip("this OS user may not create symlinks")
    try:
        with pytest.raises(workspace.WorkspaceError):
            workspace.resolve("sneaky")
    finally:
        link.unlink()


@pytest.mark.parametrize("model", [42, "bad model id!", "x" * 200])
def test_invalid_model_configuration(model):
    bad = {**DESIGN, "runtimes": {"writer": {**DESIGN["runtimes"]["writer"], "model": model}}}
    with pytest.raises(router.RoutingError) as e:
        router.resolve("writer", bad)
    assert e.value.status == 422


def test_bypass_permissions_mode_is_refused():
    bad = {**DESIGN, "runtimes": {"writer": {**DESIGN["runtimes"]["writer"], "permission_mode": "bypassPermissions"}}}
    with pytest.raises(router.RoutingError):
        router.resolve("writer", bad)


# ---------- Claude adapter ----------

def test_claude_adapter_captures_the_whole_turn():
    FakeClaudeClient.instances.clear()
    rt = ClaudeRuntime(client_factory=lambda opts: FakeClaudeClient(opts))
    sink = Sink()
    req = request_for("writer", "Write the launch post")
    result = asyncio.run(rt.invoke(req, sink))

    client = FakeClaudeClient.instances[-1]
    assert client.prompt == "Write the launch post"                      # exact prompt sent
    assert client.options.cwd == req.route.workspace_path
    assert client.options.tools == ["Read", "Glob", "Grep"] and client.options.permission_mode == "default"
    assert client.options.include_partial_messages and client.options.setting_sources == []

    assert sink.types() == ["session.started", "message.delta", "message.delta", "message.completed", "tool.started",
                            "tool.completed", "tool.started", "command.started", "tool.completed",
                            "command.completed", "message.completed", "usage.updated"]
    assert "".join(e.payload["text"] for e in sink.events if e.event_type == "message.delta") == \
           "Let me read the pricing sheet."
    read = sink.first("tool.started")
    assert read.payload["tool"] == "Read" and read.payload["input"] == {"file_path": "pricing.md"}
    assert read.why == "Let me read the pricing sheet." and read.payload["why_source"] == "preceding_assistant_text"
    bash = sink.first("command.started")
    assert bash.payload["command"] == "wc -l pricing.md" and bash.why == "Count lines in the sheet"
    assert sink.first("command.completed").payload["output"] == "9 pricing.md"
    assert not any("private reasoning" in json.dumps(e.payload) for e in sink.events)   # thinking never stored

    assert result.status == "completed" and result.final_response == "Draft: launch at ₹499."
    assert result.provider_session_id == "sess-claude-1"
    assert (result.input_tokens, result.output_tokens) == (200, 40) and result.usage["total_cost_usd"] == 0.0123


def test_claude_adapter_reports_errors():
    rt = ClaudeRuntime(client_factory=lambda opts: FakeClaudeClient(opts, fail_with=ConnectionError("CLI not logged in")))
    sink = Sink()
    result = asyncio.run(rt.invoke(request_for("writer"), sink))
    assert result.status == "failed" and "CLI not logged in" in result.error_message
    assert sink.first("execution.error").payload["error_type"] == "ConnectionError"


def test_claude_adapter_cancel_interrupts_the_client():
    rt = ClaudeRuntime(client_factory=lambda opts: FakeClaudeClient(opts, hang=True))
    req = request_for("writer")

    async def go():
        task = asyncio.create_task(rt.invoke(req, Sink()))
        await asyncio.sleep(0.05)
        assert await rt.cancel(str(req.invocation_id)) is True
        return await asyncio.wait_for(task, 5)

    result = asyncio.run(go())
    assert result.status == "failed" and "interrupted" in result.error_message
    assert asyncio.run(rt.cancel(str(uuid.uuid4()))) is False


def test_claude_permission_check_enforces_allowlist_and_workspace():
    from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny
    check = make_permission_check(request_for("writer"))
    ok = asyncio.run(check("Read", {"file_path": "pricing.md"}, None))
    outside = asyncio.run(check("Read", {"file_path": "../../secrets.txt"}, None))
    not_allowed = asyncio.run(check("Bash", {"command": "rm -rf /"}, None))
    write = asyncio.run(check("Write", {"file_path": "x.md", "content": "y"}, None))
    assert isinstance(ok, PermissionResultAllow)
    assert all(isinstance(r, PermissionResultDeny) for r in (outside, not_allowed, write))
    assert "outside the workspace" in outside.message


# ---------- Codex adapter ----------

def _codex(monkeypatch, tmp_path, mode="ok"):
    log = tmp_path / "codex.log"
    monkeypatch.setenv("FAKE_CODEX_MODE", mode)
    monkeypatch.setenv("FAKE_CODEX_LOG", str(log))
    return CodexRuntime(argv=FAKE_CODEX), log


def _sent(log):
    lines = log.read_text(encoding="utf-8").splitlines()
    return [json.loads(l) for l in lines if l != "EOF"], lines[-1] == "EOF"


def test_codex_adapter_handshake_turn_and_capture(monkeypatch, tmp_path):
    rt, log = _codex(monkeypatch, tmp_path)
    sink = Sink()
    req = request_for("researcher", "Inspect the authentication module")
    result = asyncio.run(rt.invoke(req, sink))

    sent, closed = _sent(log)
    assert [m.get("method") for m in sent[:4]] == ["initialize", "initialized", "thread/start", "turn/start"]
    assert sent[0]["params"]["clientInfo"]["name"] == "agent-control-tower"
    assert sent[2]["params"]["sandbox"] == "workspace-write" and sent[2]["params"]["cwd"] == req.route.workspace_path
    assert "You are the researcher agent" in sent[2]["params"]["developerInstructions"]
    assert sent[3]["params"]["input"] == [{"type": "text", "text": "Inspect the authentication module", "text_elements": []}]
    assert sent[4]["result"] == {"decision": "accept"}       # file change inside the workspace, agent may write
    assert closed                                              # stdin closed: the process was shut down

    assert sink.types() == ["session.started", "message.completed", "command.started", "command.output",
                            "command.completed", "approval.requested", "approval.decided", "file.changed",
                            "tool.completed", "message.delta", "message.delta", "message.completed", "usage.updated"]
    cmd = sink.first("command.started")
    assert cmd.payload["command"] == "cat auth.py"
    assert cmd.why == "I'll inspect auth.py for the login flow." and cmd.payload["why_source"] == "preceding_agent_message"
    done = sink.first("command.completed").payload
    assert (done["exit_code"], done["status"]) == (0, "completed")
    assert sink.first("approval.requested").why == "Write the review notes next to the code"
    assert sink.first("file.changed").payload == {"item_id": "f1", "path": "REVIEW.md", "kind": "add",
                                                 "diff": "+ use bcrypt", "status": "completed"}
    assert result.status == "completed" and result.final_response == "Found 3 problems."
    assert (result.provider_thread_id, result.provider_turn_id) == ("thr_test_1", "turn_test_1")
    assert (result.input_tokens, result.output_tokens) == (120, 30)


def test_codex_failed_turn(monkeypatch, tmp_path):
    rt, _ = _codex(monkeypatch, tmp_path, "fail")
    sink = Sink()
    result = asyncio.run(rt.invoke(request_for("researcher"), sink))
    assert result.status == "failed" and result.error_message == "model overloaded"
    assert sink.first("execution.error").payload["message"] == "model overloaded"


def test_codex_declines_writes_for_read_only_agents(monkeypatch, tmp_path):
    rt, log = _codex(monkeypatch, tmp_path)
    ro = {**DESIGN, "runtimes": {"researcher": {**DESIGN["runtimes"]["researcher"],
                                                "permissions": {"read": True, "write": False, "execute": True}}}}
    sink = Sink()
    asyncio.run(rt.invoke(request_for("researcher", design=ro), sink))
    sent, _ = _sent(log)
    assert sent[2]["params"]["sandbox"] == "read-only"
    assert sent[4]["result"] == {"decision": "decline"}
    assert sink.first("file.changed").payload["status"] == "declined"


def test_codex_cancel_interrupts_turn_and_cleans_up(monkeypatch, tmp_path):
    rt, log = _codex(monkeypatch, tmp_path, "hang")
    req = request_for("researcher")

    async def go():
        task = asyncio.create_task(rt.invoke(req, Sink()))
        for _ in range(100):
            await asyncio.sleep(0.05)
            turn = rt._active.get(str(req.invocation_id))
            if turn and turn.turn_id:
                break
        assert await rt.cancel(str(req.invocation_id))
        return await asyncio.wait_for(task, 10)

    result = asyncio.run(go())
    sent, closed = _sent(log)
    assert result.status == "cancelled"
    assert {"method": "turn/interrupt", "threadId": "thr_test_1", "turnId": "turn_test_1"}.items() <= \
           {"method": sent[-1]["method"], **sent[-1]["params"]}.items()
    assert closed and str(req.invocation_id) not in rt._active


def test_codex_ignores_malformed_lines(monkeypatch, tmp_path):
    rt, _ = _codex(monkeypatch, tmp_path, "garbage")
    result = asyncio.run(rt.invoke(request_for("researcher"), Sink()))
    assert result.status == "completed" and result.metadata["malformed_lines"] == 1


def test_codex_resume_uses_thread_resume(monkeypatch, tmp_path):
    rt, log = _codex(monkeypatch, tmp_path)
    req = request_for("researcher")
    result = asyncio.run(rt.resume("thr_previous", req, Sink()))
    sent, _ = _sent(log)
    assert sent[2]["method"] == "thread/resume" and sent[2]["params"]["threadId"] == "thr_previous"
    assert result.provider_thread_id == "thr_previous"


def test_codex_health_reports_auth_type_but_never_email(monkeypatch, tmp_path):
    rt, _ = _codex(monkeypatch, tmp_path)
    h = asyncio.run(rt.health())
    assert h.available and h.version == "0.146.0" and h.auth_mode == "chatgpt (plus)"
    assert "example.com" not in h.model_dump_json()


def test_jsonrpc_connection_close_terminates_process(monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_CODEX_MODE", "ok")

    async def go():
        conn = JsonRpcConnection(FAKE_CODEX)
        await conn.start()
        await conn.request("initialize", {"clientInfo": {"name": "t", "version": "1"}})
        await conn.close()
        return conn.proc.returncode

    assert asyncio.run(go()) is not None


# ---------- redaction ----------

def test_secrets_are_redacted_and_text_is_capped():
    out = redact({"cmd": "export ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz", "n": 3,
                  "auth": "Bearer abcdefghijklmnopqrstuvwxyz123"})
    assert "sk-ant-" not in json.dumps(out) and "abcdefghijklmnop" not in json.dumps(out) and out["n"] == 3
    assert redact_text("x" * 50, limit=10).startswith("x" * 10 + "... [truncated 40")
