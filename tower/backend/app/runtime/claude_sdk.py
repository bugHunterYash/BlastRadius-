"""Claude Code runtime through the official Claude Agent SDK (claude-agent-sdk).

Runs a real Claude Code agent in the invocation's workspace and turns every SDK message into
normalized events: streamed text, completed messages, tool calls and their results, Bash
commands, file edits, errors, the session id and usage. Thinking blocks are never stored.

Permissions: the available tool set is limited to the route's allowlist (`tools=`), and every
permission request goes through can_use_tool, which also refuses paths outside the workspace.
bypassPermissions is refused by the router.
"""

import asyncio
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from app.config import settings
from app.runtime import workspace
from app.runtime.base import AgentRuntime, EventSink
from app.runtime.models import ProviderHealth, RuntimeEvent, RuntimeRequest, RuntimeResult

log = logging.getLogger("tower.runtime.claude")

FILE_WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
WRITE_TOOLS = FILE_WRITE_TOOLS
EXEC_TOOLS = {"Bash", "BashOutput", "KillShell"}
PATH_KEYS = ("file_path", "path", "notebook_path")


def cli_path() -> str | None:
    if settings.CLAUDE_CLI_PATH:
        return settings.CLAUDE_CLI_PATH
    try:
        import claude_agent_sdk
    except ImportError:
        return None
    bundled = Path(claude_agent_sdk.__file__).parent / "_bundled" / ("claude.exe" if os.name == "nt" else "claude")
    return str(bundled) if bundled.exists() else shutil.which("claude")


def _text_of(content: Any) -> str:
    """Tool results arrive as a string or a list of content parts."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(p.get("text", "")) if isinstance(p, dict) else str(p) for p in content)
    return str(content)


def make_permission_check(request: RuntimeRequest):
    route = request.route
    ws = Path(route.workspace_path)
    allowed = set(route.allowed_tools)

    async def can_use_tool(tool_name: str, tool_input: dict, context):
        from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

        def deny(msg: str):
            return PermissionResultDeny(behavior="deny", message=msg, interrupt=False)

        if tool_name not in allowed:
            return deny(f"{tool_name} is not in this agent's tool allowlist")
        if tool_name in WRITE_TOOLS and not route.permissions.get("write"):
            return deny("this agent may not write files")
        if tool_name in EXEC_TOOLS and not route.permissions.get("execute"):
            return deny("this agent may not run commands")
        for key in PATH_KEYS:
            if isinstance(tool_input.get(key), str) and not workspace.contains(ws, tool_input[key]):
                return deny(f"{tool_input[key]} is outside the workspace")
        return PermissionResultAllow(behavior="allow", updated_input=tool_input)

    return can_use_tool


class ClaudeRuntime(AgentRuntime):
    name = "claude_agent_sdk"
    provider = "claude"

    def __init__(self, client_factory=None):
        # client_factory(options) -> an object with the ClaudeSDKClient interface (tests pass a fake).
        self._client_factory = client_factory
        self._clients: dict[str, Any] = {}

    def _options(self, request: RuntimeRequest):
        from claude_agent_sdk import ClaudeAgentOptions

        route = request.route
        return ClaudeAgentOptions(
            cwd=route.workspace_path,
            model=route.model,
            system_prompt=route.system_prompt,
            tools=list(route.allowed_tools),
            permission_mode=route.permission_mode,
            can_use_tool=make_permission_check(request),
            max_turns=route.max_turns,
            include_partial_messages=True,
            resume=request.resume_provider_session_id,
            setting_sources=[],            # don't pick up the host user's Claude settings or hooks
            cli_path=cli_path(),
            env={"TOWER_INVOCATION_ID": str(request.invocation_id), "TOWER_RUN_ID": request.run_id},
        )

    def _client(self, options):
        if self._client_factory:
            return self._client_factory(options)
        from claude_agent_sdk import ClaudeSDKClient
        return ClaudeSDKClient(options=options)

    async def invoke(self, request: RuntimeRequest, emit: EventSink) -> RuntimeResult:
        try:
            options = self._options(request)
        except ImportError as exc:
            await emit(RuntimeEvent(event_type="execution.error", payload={"message": f"claude-agent-sdk missing: {exc}"}))
            return RuntimeResult(status="failed", error_message="claude-agent-sdk is not installed")
        client = self._client(options)
        key = str(request.invocation_id)
        self._clients[key] = client
        state = {"session_id": None, "last_text": None, "texts": [], "tools": {}, "result": None}
        try:
            async with client:
                await client.query(request.prompt)
                async for msg in client.receive_response():
                    await self._handle(msg, state, emit)
        except Exception as exc:  # CLINotFoundError, ProcessError, CLIJSONDecodeError, auth failures
            log.warning("claude invocation %s failed: %r", key, exc)
            await emit(RuntimeEvent(event_type="execution.error",
                                    payload={"message": str(exc), "error_type": type(exc).__name__}))
            return RuntimeResult(status="failed", error_message=f"{type(exc).__name__}: {exc}",
                                 provider_session_id=state["session_id"],
                                 final_response=state["last_text"])
        finally:
            self._clients.pop(key, None)

        res = state["result"]
        if res is None:
            return RuntimeResult(status="failed", error_message="the Claude run ended without a result message",
                                 provider_session_id=state["session_id"], final_response=state["last_text"])
        usage = res.usage or {}
        return RuntimeResult(
            status="failed" if res.is_error else "completed",
            final_response=res.result if res.result is not None else state["last_text"],
            provider_session_id=res.session_id or state["session_id"],
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            usage={**usage, "total_cost_usd": res.total_cost_usd, "num_turns": res.num_turns,
                   "duration_ms": res.duration_ms},
            # e.g. "success: Not logged in · Please run /login" -- the CLI puts the reason in result, not errors
            error_message=(f"{res.subtype}: {'; '.join(map(str, res.errors or [])) or res.result or 'unknown error'}"
                           if res.is_error else None),
            metadata={"subtype": res.subtype, "stop_reason": res.stop_reason},
        )

    async def _handle(self, msg, state: dict, emit: EventSink) -> None:
        from claude_agent_sdk import (AssistantMessage, ResultMessage, StreamEvent, SystemMessage, TextBlock,
                                      ToolResultBlock, ToolUseBlock, UserMessage)

        if isinstance(msg, SystemMessage):
            if msg.subtype == "init":
                data = msg.data or {}
                state["session_id"] = data.get("session_id")
                await emit(RuntimeEvent(event_type="session.started", dedupe_key="session.init", payload={
                    "session_id": data.get("session_id"), "model": data.get("model"),
                    "tools": data.get("tools"), "permission_mode": data.get("permissionMode"),
                    "cwd": data.get("cwd")}))
        elif isinstance(msg, StreamEvent):
            ev = msg.event or {}
            delta = ev.get("delta") or {}
            if ev.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                await emit(RuntimeEvent(event_type="message.delta", payload={"text": delta.get("text", "")}))
        elif isinstance(msg, AssistantMessage):
            for i, block in enumerate(msg.content):
                if isinstance(block, TextBlock):
                    state["last_text"] = block.text
                    await emit(RuntimeEvent(event_type="message.completed",
                                            dedupe_key=f"msg:{msg.message_id or msg.uuid}:{i}",
                                            payload={"text": block.text, "model": msg.model}))
                elif isinstance(block, ToolUseBlock):
                    state["tools"][block.id] = (block.name, block.input)
                    # A public explanation only: the tool's own description field, else the visible
                    # text the assistant wrote just before calling it. Nothing invented.
                    why, source = None, None
                    if isinstance(block.input.get("description"), str):
                        why, source = block.input["description"], "tool_input.description"
                    elif state["last_text"]:
                        why, source = state["last_text"][:300], "preceding_assistant_text"
                    await emit(RuntimeEvent(event_type="tool.started", why=why, dedupe_key=f"tool:{block.id}:start",
                                            payload={"tool_use_id": block.id, "tool": block.name,
                                                     "input": block.input, "why_source": source}))
                    if block.name == "Bash":
                        await emit(RuntimeEvent(event_type="command.started", why=why,
                                                dedupe_key=f"cmd:{block.id}:start",
                                                payload={"tool_use_id": block.id, "command": block.input.get("command")}))
                # ThinkingBlock is deliberately dropped: hidden reasoning is never stored.
        elif isinstance(msg, UserMessage):
            content = msg.content if isinstance(msg.content, list) else []
            for block in content:
                if not isinstance(block, ToolResultBlock):
                    continue
                name, tool_input = state["tools"].get(block.tool_use_id, (None, {}))
                output = _text_of(block.content)
                failed = bool(block.is_error)
                await emit(RuntimeEvent(event_type="tool.completed", dedupe_key=f"tool:{block.tool_use_id}:done",
                                        payload={"tool_use_id": block.tool_use_id, "tool": name,
                                                 "is_error": failed, "output": output}))
                if name == "Bash":
                    await emit(RuntimeEvent(event_type="command.completed", dedupe_key=f"cmd:{block.tool_use_id}:done",
                                            payload={"tool_use_id": block.tool_use_id,
                                                     "command": tool_input.get("command"),
                                                     "is_error": failed, "output": output}))
                if name in FILE_WRITE_TOOLS and not failed:
                    path = next((tool_input[k] for k in PATH_KEYS if k in tool_input), None)
                    await emit(RuntimeEvent(event_type="file.changed", dedupe_key=f"file:{block.tool_use_id}",
                                            payload={"tool_use_id": block.tool_use_id, "tool": name, "path": path}))
        elif isinstance(msg, ResultMessage):
            state["result"] = msg
            if msg.usage:
                await emit(RuntimeEvent(event_type="usage.updated", dedupe_key="usage.final",
                                        payload={"usage": msg.usage, "total_cost_usd": msg.total_cost_usd}))
            if msg.is_error:
                await emit(RuntimeEvent(event_type="execution.error", dedupe_key="result.error", payload={
                    "subtype": msg.subtype, "errors": msg.errors, "api_error_status": msg.api_error_status}))

    async def cancel(self, invocation_id: str) -> bool:
        client = self._clients.get(invocation_id)
        if client is None:
            return False
        try:
            await client.interrupt()
        except Exception as exc:
            log.warning("claude interrupt failed for %s: %r", invocation_id, exc)
            return False
        return True

    async def health(self) -> ProviderHealth:
        enabled = settings.CLAUDE_RUNTIME_ENABLED
        auth = "api_key" if os.environ.get("ANTHROPIC_API_KEY") else "claude_cli_login"
        try:
            import claude_agent_sdk
        except ImportError:
            return ProviderHealth(provider="claude", enabled=enabled, available=False,
                                  detail="claude-agent-sdk is not installed", auth_mode=auth)
        path = cli_path()
        if not path:
            return ProviderHealth(provider="claude", enabled=enabled, available=False,
                                  detail="Claude Code CLI not found", auth_mode=auth)
        try:
            proc = await asyncio.create_subprocess_exec(path, "--version", stdout=asyncio.subprocess.PIPE,
                                                        stderr=asyncio.subprocess.PIPE)
            out, _ = await asyncio.wait_for(proc.communicate(), 20)
        except (OSError, asyncio.TimeoutError) as exc:
            return ProviderHealth(provider="claude", enabled=enabled, available=False,
                                  detail=f"CLI did not start: {exc!r}", auth_mode=auth)
        version = out.decode(errors="replace").strip()
        return ProviderHealth(
            provider="claude", enabled=enabled, available=proc.returncode == 0, version=version, auth_mode=auth,
            detail=f"sdk {claude_agent_sdk.__version__}, CLI runs; login is verified on the first invocation",
        )
