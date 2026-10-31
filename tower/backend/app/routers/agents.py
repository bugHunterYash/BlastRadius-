import asyncio
import hmac
import uuid
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app import db, execution, execution_db as xdb, meko_client
from app.agents import summarizer
from app.config import settings
from app.runtime import auth as agent_auth
from app.runtime import router as agent_router
from app.runtime.models import InvokeRequest

router = APIRouter(tags=["agent runtime"])


def require_api_token(authorization: str = Header(default="")) -> None:
    """Invoking or cancelling an agent runs code, so it needs a token (TOWER_API_TOKEN, else the ingest token)."""
    expected = settings.TOWER_API_TOKEN or settings.TOWER_INGEST_TOKEN
    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(401, "bad or missing API token")


@router.post("/v1/agents/{agent_id}/invoke", status_code=202, dependencies=[Depends(require_api_token)])
async def invoke(agent_id: str, body: InvokeRequest, response: Response):
    """Route the task to the agent's configured runtime (Claude Agent SDK or Codex App Server) and run it
    in the background. Watch it on /v1/stream or poll /v1/invocations/{id}/events."""
    try:
        inv, created = await execution.submit(agent_id, body)
    except agent_router.RoutingError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    if not created:
        response.status_code = 200
    return {"invocation_id": inv["invocation_id"], "run_id": inv["run_id"], "agent_id": agent_id,
            "provider": inv["provider"], "runtime": inv["runtime"], "model": inv["model"],
            "status": inv["status"], "created": created}


@router.get("/v1/agents")
async def agents():
    """Every agent in the active design with its resolved route, or why it can't be routed."""
    design = await db.get_design()
    out = []
    for a in design.get("agents", []):
        try:
            r = agent_router.resolve(a, design)
            out.append({"agent_id": a, "routable": True, "provider": r.provider, "runtime": r.runtime,
                        "model": r.model, "workspace_id": r.workspace_id, "allowed_tools": r.allowed_tools,
                        "permissions": r.permissions, "sandbox": r.sandbox})
        except agent_router.RoutingError as exc:
            out.append({"agent_id": a, "routable": False, "reason": str(exc)})
    return out


@router.get("/v1/agents/providers/health")
async def providers_health():
    """Real checks: each runtime starts and handshakes, Ollama answers and has the model, Postgres answers,
    Meko lists its tools. Configuration alone never counts as available."""
    rt = agent_router.registry()
    claude, codex = await asyncio.gather(rt["claude_agent_sdk"].health(), rt["codex_app_server"].health())

    ollama = {"available": False, "model": settings.OLLAMA_MODEL or None}
    try:
        async with httpx.AsyncClient(base_url=settings.OLLAMA_URL, timeout=5) as c:
            tags = (await c.get("/api/tags")).json()
        names = {m.get("name") for m in tags.get("models", [])}
        ollama.update(reachable=True, model_installed=settings.OLLAMA_MODEL in names,
                      available=bool(settings.OLLAMA_MODEL) and settings.OLLAMA_MODEL in names)
    except (httpx.HTTPError, ValueError) as exc:
        ollama.update(reachable=False, detail=repr(exc))

    try:
        pg = {"available": await db.health()}
    except Exception as exc:
        pg = {"available": False, "detail": repr(exc)}

    if settings.notebook_mode == "meko":
        try:
            tools = await asyncio.wait_for(meko_client.list_meko_tools(), 15)
            meko = {"mode": "meko", "available": True, "tools": tools}
        except Exception as exc:
            meko = {"mode": "meko", "available": False, "detail": repr(exc)}
    else:
        meko = {"mode": "local", "available": False,
                "detail": "MEKO_MCP_URL not set; the local notebook table stands in for the Datapack"}

    return {"claude": claude.model_dump(), "codex": codex.model_dump(), "ollama": ollama,
            "summarizer": summarizer.label(), "postgres": pg, "meko": meko,
            "replay": (await rt["replay"].health()).model_dump(),
            "max_concurrency": settings.AGENT_MAX_CONCURRENCY}


Provider = Literal["claude", "codex"]


class LoginCode(BaseModel):
    code: str = Field(min_length=1, max_length=500)


@router.get("/v1/agents/auth", dependencies=[Depends(require_api_token)])
async def auth_status():
    """Whether each runtime is signed in (method and plan only, never emails), plus any sign-in in progress."""
    return await agent_auth.status()


@router.post("/v1/agents/auth/{provider}/login", status_code=202, dependencies=[Depends(require_api_token)])
async def auth_login(provider: Provider):
    """Start the provider's own sign-in: Claude opens Anthropic's page (Google sign-in is there), Codex
    returns a ChatGPT sign-in URL. Poll GET /v1/agents/auth until status is succeeded or failed."""
    return await agent_auth.start_login(provider)


@router.post("/v1/agents/auth/claude/code", dependencies=[Depends(require_api_token)])
async def auth_claude_code(body: LoginCode):
    """For sign-in flows that show a code to paste back into the CLI."""
    if not await agent_auth.submit_claude_code(body.code):
        raise HTTPException(409, "no Claude sign-in is waiting for a code")
    return {"submitted": True}


@router.post("/v1/agents/auth/{provider}/cancel", dependencies=[Depends(require_api_token)])
async def auth_cancel(provider: Provider):
    if not await agent_auth.cancel_login(provider):
        raise HTTPException(409, "no sign-in in progress")
    return {"cancelled": True}


@router.get("/v1/invocations/{invocation_id}")
async def invocation(invocation_id: uuid.UUID):
    """Full prompt and system prompt, final response, provider ids, usage, routing decision, event
    counts and the memory (notebook) events made during this invocation."""
    inv = await xdb.get_invocation(invocation_id)
    if inv is None:
        raise HTTPException(404, "invocation not found")
    inv["running"] = execution.is_running(str(invocation_id))
    return inv


@router.get("/v1/invocations/{invocation_id}/events")
async def invocation_events(invocation_id: uuid.UUID, after_sequence: int = Query(0, ge=0),
                            limit: int = Query(500, ge=1, le=5000), types: str | None = None):
    """Chronological events. Replay after a reconnect with after_sequence=<last seen>."""
    if await xdb.get_invocation(invocation_id) is None:
        raise HTTPException(404, "invocation not found")
    type_list = [t.strip().removeprefix("agent.") for t in types.split(",")] if types else None
    return await xdb.list_events(invocation_id, after_sequence, limit, type_list)


@router.post("/v1/invocations/{invocation_id}/cancel", status_code=202, dependencies=[Depends(require_api_token)])
async def cancel(invocation_id: uuid.UUID):
    inv = await xdb.get_invocation(invocation_id)
    if inv is None:
        raise HTTPException(404, "invocation not found")
    if not await execution.cancel(str(invocation_id)):
        raise HTTPException(409, f"invocation is not running (status: {inv['status']})")
    return {"invocation_id": str(invocation_id), "cancel_requested": True}


@router.get("/v1/runs/{run_id}/invocations")
async def run_invocations(run_id: str, full: bool = False):
    """Invocations of a run. full=true includes each complete prompt and answer (used for chat history)."""
    return {"run_id": run_id, "summary": await xdb.execution_summary(run_id),
            "invocations": await xdb.run_invocations(run_id, full)}
