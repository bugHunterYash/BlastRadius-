"""Execution service: route an invocation, run it on its adapter, persist every event, then publish it.

Order for each event: redact -> insert with the next sequence (PostgreSQL) -> publish on SSE as
"agent.<event_type>". Nothing is published that was not stored first.
"""

import asyncio
import logging
import uuid

from app import db, execution_db as xdb, stream
from app.config import settings
from app.runtime import router
from app.runtime.base import AgentRuntime
from app.runtime.models import InvokeRequest, RuntimeEvent, RuntimeRequest, RuntimeResult
from app.runtime.redact import MAX_PROMPT, redact, redact_text

log = logging.getLogger("tower.execution")

_slots: asyncio.Semaphore | None = None
_tasks: dict[str, asyncio.Task] = {}
_runtime_of: dict[str, AgentRuntime] = {}
_cancel_requested: set[str] = set()


def start() -> None:
    global _slots
    _slots = asyncio.Semaphore(max(1, settings.AGENT_MAX_CONCURRENCY))
    _tasks.clear()
    _runtime_of.clear()
    _cancel_requested.clear()


async def recover_interrupted() -> int:
    """Tasks still queued or running when the server starts can't still be running: their process died
    with the old server (a crash, out of memory, a restart). Mark them failed, with the reason in their
    timeline, so they don't show as "running" forever. Chats synced from other apps aren't touched."""
    rows = await db.pool.fetch(
        """UPDATE agent_invocations SET status = 'failed', completed_at = clock_timestamp(),
                  error_message = 'Interrupted: the Control Tower server stopped while this task was running'
           WHERE status IN ('queued', 'running') AND runtime IN ('claude_agent_sdk', 'codex_app_server', 'antigravity_cli', 'replay')
           RETURNING invocation_id""")
    for r in rows:
        await xdb.append_events_bulk(str(r["invocation_id"]), [("invocation.failed", None, {
            "error": "Interrupted: the Control Tower server stopped while this task was running", "recovered": True})])
    return len(rows)


async def shutdown() -> None:
    for iid in list(_tasks):
        await cancel(iid)
    await asyncio.gather(*_tasks.values(), return_exceptions=True)


def envelope(inv: dict, ev: dict) -> dict:
    return {"run_id": inv["run_id"], "agent_id": inv["agent_id"], "invocation_id": inv["invocation_id"],
            "provider": inv["provider"], "sequence": ev["sequence"], "timestamp": ev["created_at"],
            "event_type": f"agent.{ev['event_type']}", "why": ev["why"], "payload": ev["payload"]}


async def record(inv: dict, event_type: str, why: str | None = None, payload: dict | None = None,
                 dedupe_key: str | None = None) -> dict | None:
    ev = await xdb.append_event(inv["invocation_id"], event_type, redact_text(why, 500) if why else None,
                                redact(payload or {}), dedupe_key)
    if ev is None:
        return None
    env = envelope(inv, ev)
    await stream.publish(env["event_type"], env)
    return env


async def submit(agent_id: str, body: InvokeRequest) -> tuple[dict, bool]:
    """Validate, route and queue an invocation. Returns (invocation, created). Raises RoutingError."""
    design = await db.get_design()
    route = router.resolve(agent_id, design, body.workspace_id, await xdb.active_design_id(), body.read_only)
    runtime = router.registry().get(route.runtime)
    if runtime is None:
        raise router.RoutingError(503, f"runtime {route.runtime!r} is not available")

    resume_id, session_uuid = None, None
    if body.session_id:
        session = await xdb.get_session(body.session_id)
        if session is None or session["agent_id"] != agent_id or session["provider"] != route.provider:
            raise router.RoutingError(404, "session not found for this agent and provider")
        resume_id, session_uuid = session["provider_session_id"], body.session_id

    inv, created = await xdb.create_invocation(
        run_id=body.run_id, agent_id=agent_id, provider=route.provider, runtime=route.runtime, model=route.model,
        workspace_id=route.workspace_id, why=body.why, system_prompt=route.system_prompt,
        user_prompt=redact_text(body.prompt, MAX_PROMPT), routing=route.model_dump(), session_id=session_uuid,
        idempotency_key=body.idempotency_key,
    )
    if not created:
        return inv, False
    await record(inv, "invocation.created", body.why, {
        "provider": route.provider, "runtime": route.runtime, "model": route.model or "provider default",
        "workspace_id": route.workspace_id, "allowed_tools": route.allowed_tools, "permissions": route.permissions,
        "sandbox": route.sandbox, "permission_mode": route.permission_mode, "resume": bool(resume_id),
        "design_id": route.design_id})
    request = RuntimeRequest(invocation_id=uuid.UUID(inv["invocation_id"]), run_id=body.run_id, agent_id=agent_id,
                             prompt=body.prompt, why=body.why, route=route, resume_provider_session_id=resume_id)
    _runtime_of[inv["invocation_id"]] = runtime
    _tasks[inv["invocation_id"]] = asyncio.create_task(_run(inv, runtime, request))
    return inv, True


async def _run(inv: dict, runtime: AgentRuntime, request: RuntimeRequest) -> None:
    iid = inv["invocation_id"]
    try:
        async with _slots:
            if iid in _cancel_requested:
                await _finish(inv, request, RuntimeResult(status="cancelled", error_message="cancelled before start"))
                return
            await xdb.mark_started(iid)
            await record(inv, "invocation.started", None, {"provider": request.route.provider})
            await record(inv, "prompt.received", request.why, {
                "prompt": request.prompt, "system_prompt": request.route.system_prompt,
                "model": request.route.model, "provider": request.route.provider}, dedupe_key="prompt")

            async def emit(ev: RuntimeEvent) -> None:
                await record(inv, ev.event_type, ev.why, ev.payload, ev.dedupe_key)

            try:
                if request.resume_provider_session_id:
                    coro = runtime.resume(request.resume_provider_session_id, request, emit)
                else:
                    coro = runtime.invoke(request, emit)
                result = await asyncio.wait_for(coro, request.route.timeout_s)
            except asyncio.TimeoutError:
                await runtime.cancel(iid)
                result = RuntimeResult(status="timeout", error_message=f"timed out after {request.route.timeout_s:.0f}s")
            except asyncio.CancelledError:
                result = RuntimeResult(status="cancelled", error_message="cancelled")
            except Exception as exc:
                log.exception("invocation %s crashed", iid)
                await record(inv, "execution.error", None, {"message": str(exc), "error_type": type(exc).__name__})
                result = RuntimeResult(status="failed", error_message=f"{type(exc).__name__}: {exc}")
            if iid in _cancel_requested and result.status != "completed":
                result.status = "cancelled"
            await asyncio.shield(_finish(inv, request, result))
    finally:
        _tasks.pop(iid, None)
        _runtime_of.pop(iid, None)
        _cancel_requested.discard(iid)


async def _finish(inv: dict, request: RuntimeRequest, result: RuntimeResult) -> None:
    session_id = None
    if result.provider_session_id:
        session_id = await xdb.upsert_session(
            run_id=inv["run_id"], agent_id=inv["agent_id"], provider=inv["provider"],
            provider_session_id=result.provider_session_id, workspace_id=inv["workspace_id"],
            status="active" if result.status == "completed" else result.status)
    final = await xdb.finalize(
        inv["invocation_id"], status=result.status,
        final_response=redact_text(result.final_response, MAX_PROMPT) if result.final_response else None,
        error_message=redact_text(result.error_message, 2000) if result.error_message else None,
        provider_thread_id=result.provider_thread_id or result.provider_session_id,
        provider_turn_id=result.provider_turn_id, input_tokens=result.input_tokens,
        output_tokens=result.output_tokens, usage=redact(result.usage) if result.usage else None,
        metadata=redact(result.metadata), session_id=session_id)
    terminal = {"completed": "invocation.completed", "cancelled": "invocation.cancelled"}.get(result.status,
                                                                                             "invocation.failed")
    await record(inv, terminal, None, {
        "status": result.status, "error": final["error_message"], "session_id": str(session_id) if session_id else None,
        "provider_session_id": result.provider_session_id, "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens, "final_response": final["final_response"]}, dedupe_key="terminal")


async def cancel(invocation_id: str) -> bool:
    """Ask the provider to stop; if it doesn't, cancel the task. False if not running."""
    task = _tasks.get(invocation_id)
    if task is None or task.done():
        return False
    _cancel_requested.add(invocation_id)
    runtime = _runtime_of.get(invocation_id)
    stopped = await runtime.cancel(invocation_id) if runtime else False
    if not stopped:
        task.cancel()
    return True


async def wait(invocation_id: str) -> dict | None:
    """Wait until an invocation has finished (it may already have), then return its row."""
    task = _tasks.get(invocation_id)
    if task is not None:
        await asyncio.gather(asyncio.shield(task), return_exceptions=True)
    return await xdb.get_invocation(uuid.UUID(invocation_id))


def is_running(invocation_id: str) -> bool:
    t = _tasks.get(invocation_id)
    return t is not None and not t.done()
