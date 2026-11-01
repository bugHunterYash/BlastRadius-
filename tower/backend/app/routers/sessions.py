from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app import live_sync, projects, session_import
from app.routers.agents import require_api_token

router = APIRouter(tags=["claude code sessions"])


class ImportBody(BaseModel):
    run_id: str | None = Field(default=None, max_length=200, pattern=r"^[A-Za-z0-9._:-]+$")
    agent_id: str = Field(default="claude-code", max_length=100)
    directory: str | None = None
    max_messages: int = Field(default=5000, ge=1, le=50_000)


@router.get("/v1/claude-sessions", dependencies=[Depends(require_api_token)])
async def local_sessions(limit: int = Query(50, ge=1, le=500), directory: str | None = None):
    """Claude Code sessions saved on this machine (desktop app, CLI, IDE), newest first.
    Token-protected: titles and first prompts can be private."""
    try:
        return await session_import.list_local(limit, directory)
    except ImportError as exc:
        raise HTTPException(503, "claude-agent-sdk is not installed") from exc


@router.post("/v1/claude-sessions/{session_id}/import", status_code=201, dependencies=[Depends(require_api_token)])
async def import_session(session_id: str, response: Response, body: ImportBody | None = None):
    """Import one session as an invocation (read-only, idempotent). Then open it with
    /v1/invocations/{invocation_id} and /events, like any live run."""
    body = body or ImportBody()
    try:
        inv, created = await session_import.import_session(session_id, body.run_id, body.agent_id,
                                                           body.directory, body.max_messages)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    if not created:
        response.status_code = 200
    return {"invocation_id": inv["invocation_id"], "run_id": inv["run_id"], "created": created,
            "status": inv["status"], "runtime": inv["runtime"], "events": inv["last_sequence"],
            "title": (inv.get("metadata") or {}).get("title")}


@router.get("/v1/live/sessions", dependencies=[Depends(require_api_token)])
async def live_sessions(limit: int = Query(30, ge=1, le=200)):
    """Chats synced live from the Claude app / Claude Code and the Codex app, newest first."""
    return await live_sync.live_sessions(limit)


@router.post("/v1/live/sync", dependencies=[Depends(require_api_token)])
async def sync_now():
    """Run one sync pass now instead of waiting for the next tick."""
    return {"changes": await live_sync.sync_once()}


class ProjectBody(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


@router.get("/v1/projects", dependencies=[Depends(require_api_token)])
async def list_projects():
    """Project folders agents can be assigned work in."""
    return await projects.list_projects()


@router.post("/v1/projects", status_code=201, dependencies=[Depends(require_api_token)])
async def add_project(body: ProjectBody):
    """Add a project folder (only one where a synced agent session already works). Idempotent."""
    try:
        return await projects.register(body.path)
    except projects.ProjectError as exc:
        raise HTTPException(422, str(exc)) from exc
