"""Antigravity runtime through the Antigravity CLI in print mode (`agy -p ... --output-format stream-json`).

One process per invocation; one JSON object per stdout line (checked against agy 2.28):
  {"event": "init", "conversation_id", "init": {"model", "cwd", "tools", "permission_mode"}}
  {"event": "step_update", "step_update": {"step_index", "state": ACTIVE|DONE|ERROR, "step_type":
       user_input | agent_response (text_delta, usage) | tool (tool_name, tool_info {parameters, output, error})}}
  {"event": "result", "result": {"status": SUCCESS|..., "response", "usage", "denied_actions"}}
A follow-up continues the same conversation with `--conversation <id>`.

Permissions: headless agy can't ask for approval, and its terminal sandbox isn't available on every
host, so shell commands are never granted here. Agents read with the file tools (read_file, view_file,
list_dir, grep_search); `--mode accept-edits` is passed only when the agent may write. Thinking is not stored.
"""

import asyncio
import contextlib
import json
import logging
import os
import shutil
from pathlib import Path

from app.config import settings
from app.runtime import workspace
from app.runtime.base import AgentRuntime, EventSink
from app.runtime.models import ProviderHealth, RuntimeEvent, RuntimeRequest, RuntimeResult

log = logging.getLogger("tower.runtime.antigravity")
WRITE_TOOLS = {"write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"}
COMMAND_TOOLS = {"run_command", "send_command_input"}
TOOL_RULES = ("Shell commands are not available in this session: read files with read_file, view_file, list_dir, "
              "grep_search or find_by_name.")


def agy_path() -> str | None:
    if settings.ANTIGRAVITY_BIN:
        return shutil.which(settings.ANTIGRAVITY_BIN) or (settings.ANTIGRAVITY_BIN if Path(settings.ANTIGRAVITY_BIN).is_file() else None)
    found = shutil.which("agy")
    default = Path.home() / ".gemini" / "bin" / ("agy.exe" if os.name == "nt" else "agy")
    return found or (str(default) if default.is_file() else None)


def _path_of(params: dict) -> str | None:
    for k in ("TargetFile", "Path", "AbsolutePath", "FilePath", "path", "file_path"):
        if params.get(k):
            return str(params[k])
    return None


class AntigravityRuntime(AgentRuntime):
    name = "antigravity_cli"
    provider = "antigravity"

    def __init__(self, argv: list[str] | None = None):
        self._argv = argv                       # tests pass a fake CLI here
        self._procs: dict[str, asyncio.subprocess.Process] = {}
        self._cancelled: set[str] = set()

    def _command(self, request: RuntimeRequest) -> list[str]:
        route = request.route
        exe = self._argv or [agy_path() or "agy"]
        prompt = "\n\n".join(p for p in (route.system_prompt, TOOL_RULES, f"Task: {request.prompt}") if p)
        args = [*exe, "-p", prompt, "--output-format", "stream-json"]
        if route.model:
            args += ["--model", route.model]
        if route.permissions.get("write"):
            args += ["--mode", "accept-edits"]
        if request.resume_provider_session_id:
            args += ["--conversation", request.resume_provider_session_id]
        return args

    async def invoke(self, request: RuntimeRequest, emit: EventSink) -> RuntimeResult:
        route, key = request.route, str(request.invocation_id)
        ws = Path(route.workspace_path)
        try:
            proc = await asyncio.create_subprocess_exec(
                *self._command(request), cwd=route.workspace_path, stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=16 * 1024 * 1024,
                env={**os.environ, "TOWER_INVOCATION_ID": key, "TOWER_RUN_ID": request.run_id})
        except OSError as exc:
            await emit(RuntimeEvent(event_type="execution.error", payload={"message": f"could not start agy: {exc}"}))
            return RuntimeResult(status="failed", error_message=f"could not start agy: {exc}")
        self._procs[key] = proc
        stderr_task = asyncio.create_task(proc.stderr.read())
        conv: str | None = None
        texts: dict[int, str] = {}
        last_text: str | None = None
        result: dict = {}
        try:
            async for raw in proc.stdout:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                kind = msg.get("event")
                if kind == "init":
                    conv = msg.get("conversation_id")
                    init = msg.get("init") or {}
                    await emit(RuntimeEvent(event_type="session.started", dedupe_key=f"conv:{conv}", payload={
                        "conversation_id": conv, "model": init.get("model"), "permission_mode": init.get("permission_mode"),
                        "resumed": bool(request.resume_provider_session_id)}))
                elif kind == "step_update":
                    s = msg.get("step_update") or {}
                    i, state, stype = s.get("step_index"), s.get("state"), s.get("step_type")
                    if stype == "agent_response":
                        if s.get("text_delta"):
                            texts[i] = texts.get(i, "") + s["text_delta"]
                            await emit(RuntimeEvent(event_type="message.delta", payload={"item_id": f"step-{i}", "text": s["text_delta"]}))
                        if state == "DONE" and texts.get(i, "").strip():
                            last_text = texts[i].strip()
                            await emit(RuntimeEvent(event_type="message.completed", dedupe_key=f"{i}:done",
                                                    payload={"item_id": f"step-{i}", "text": last_text}))
                        if s.get("usage"):
                            await emit(RuntimeEvent(event_type="usage.updated", payload={"usage": s["usage"]}))
                    elif stype == "tool":
                        await self._tool(s, ws, last_text, emit)
                elif kind == "result":
                    result = msg.get("result") or {}
            await proc.wait()
        finally:
            self._procs.pop(key, None)
            if proc.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                await proc.wait()
        err = (await stderr_task).decode(errors="replace").strip()

        for d in result.get("denied_actions") or []:
            await emit(RuntimeEvent(event_type="approval.requested", payload={"kind": d.get("action"), "tool": d.get("display_name")}))
            await emit(RuntimeEvent(event_type="approval.decided", payload={
                "kind": d.get("action"), "decision": "decline", "decided_by": "antigravity headless policy"}))
        usage = result.get("usage") or {}
        answer = (result.get("response") or "").strip()
        final = answer or last_text
        if key in self._cancelled:
            self._cancelled.discard(key)
            status, error = "cancelled", "cancelled"
        elif result.get("status") == "SUCCESS" and answer:   # no answer = it was blocked (e.g. a denied command)
            status, error = "completed", None
        else:
            status = "failed"
            error = (err.splitlines()[-1] if err else None) or f"agy ended with status {result.get('status') or proc.returncode}"
            await emit(RuntimeEvent(event_type="execution.error", payload={"message": error}))
        return RuntimeResult(status=status, final_response=final, error_message=error, provider_session_id=conv,
                             provider_thread_id=conv, input_tokens=usage.get("input_tokens"),
                             output_tokens=usage.get("output_tokens"), usage=usage or None,
                             metadata={"duration_s": result.get("duration_seconds"), "turns": result.get("num_turns")})

    async def _tool(self, s: dict, ws: Path, why: str | None, emit: EventSink) -> None:
        i, state = s.get("step_index"), s.get("state")
        info = s.get("tool_info") or {}
        name, params = s.get("tool_name") or info.get("name"), info.get("parameters") or {}
        why = why[:300] if why else None
        src = {"why_source": "preceding_agent_message"} if why else {}
        iid = f"step-{i}"
        if name in COMMAND_TOOLS:
            if state == "ACTIVE":
                await emit(RuntimeEvent(event_type="command.started", why=why, dedupe_key=f"{i}:start",
                                        payload={"item_id": iid, "command": params.get("CommandLine"), **src}))
            else:
                await emit(RuntimeEvent(event_type="command.completed", dedupe_key=f"{i}:done", payload={
                    "item_id": iid, "command": params.get("CommandLine"), "status": "failed" if state == "ERROR" else "completed",
                    "output": info.get("output") or (info.get("error") or {}).get("message")}))
            return
        if state == "ACTIVE":
            await emit(RuntimeEvent(event_type="tool.started", why=why, dedupe_key=f"{i}:start",
                                    payload={"item_id": iid, "tool": name, "input": params, **src}))
            return
        failed = state == "ERROR"
        await emit(RuntimeEvent(event_type="tool.completed", dedupe_key=f"{i}:done", payload={
            "item_id": iid, "tool": name, "status": "failed" if failed else "completed",
            "output": info.get("output") or (info.get("error") or {}).get("message")}))
        path = _path_of(params)
        if name in WRITE_TOOLS and not failed and path:
            await emit(RuntimeEvent(event_type="file.changed", dedupe_key=f"{i}:file", payload={
                "item_id": iid, "path": path, "tool": name, "inside_workspace": workspace.contains(ws, path)}))

    async def cancel(self, invocation_id: str) -> bool:
        proc = self._procs.get(invocation_id)
        if proc is None:
            return False
        self._cancelled.add(invocation_id)
        with contextlib.suppress(ProcessLookupError):
            proc.terminate()
        return True

    async def health(self) -> ProviderHealth:
        enabled = settings.ANTIGRAVITY_RUNTIME_ENABLED
        exe = self._argv or ([agy_path()] if agy_path() else None)
        if not exe:
            return ProviderHealth(provider="antigravity", enabled=enabled, available=False,
                                  detail="Antigravity CLI (agy) not found; install Antigravity and run `agy install`")
        ok, detail = await models_check(exe)
        return ProviderHealth(provider="antigravity", enabled=enabled, available=ok, detail=detail,
                              auth_mode="google" if ok else "not signed in")


async def models_check(exe: list[str]) -> tuple[bool, str]:
    """`agy models` only lists models when the CLI is signed in, so it doubles as the sign-in check."""
    try:
        proc = await asyncio.create_subprocess_exec(*exe, "models", stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.PIPE, stdin=asyncio.subprocess.DEVNULL)
        out, err = await asyncio.wait_for(proc.communicate(), 40)
    except (OSError, asyncio.TimeoutError) as exc:
        return False, f"agy models failed: {exc!r}"
    models = [l.split("\t")[0] for l in out.decode(errors="replace").splitlines() if "\t" in l]
    if proc.returncode == 0 and models:
        return True, f"{len(models)} models available"
    return False, (err.decode(errors="replace").strip() or "not signed in; open Antigravity and sign in with Google")[:300]

