import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app import db, execution_db as xdb

router = APIRouter(tags=["issues"])
Status = Literal["open", "fix_ready", "approved", "rejected", "resolved"]


@router.get("/v1/issues")
async def issues(status: Status | None = None, run_id: str | None = None, limit: int = Query(200, ge=1, le=500)):
    return await db.list_issues(status, run_id, limit)


@router.get("/v1/issues/{issue_id}")
async def issue(issue_id: uuid.UUID):
    """Issue, its evidence events, the fix, and the agent invocations it is linked to (open them with
    /v1/invocations/{id} to see the exact prompt, response and tool events)."""
    found = await db.get_issue(issue_id)
    if found is None:
        raise HTTPException(404, "issue not found")
    found["invocations"] = await xdb.invocations_for_issue(issue_id)
    return found
