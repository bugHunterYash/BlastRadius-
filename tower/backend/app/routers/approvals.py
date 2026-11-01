import json
import uuid

from fastapi import APIRouter, HTTPException, Query

from app import agent_config, db, meko_client, stream
from app.models import Decision

router = APIRouter(tags=["approvals"])


async def _apply_fix(conn, fix: dict, approver: str) -> None:
    """Change the system: a config edit for text fixes, a new design snapshot for permission fixes."""
    if fix["fix_type"] == "permission":
        design = await db.get_design()
        design["permissions"][fix["target_agent"]] = json.loads(fix["after"])
        await db.save_design(design, conn=conn)
    else:
        agent_config.apply_text_fix(fix["target_agent"], fix["before"], fix["after"])
    agent_config.git_commit(f"fix {fix['fix_id'][:4]}: {fix['target_agent']} {fix['fix_type']} (approved by {approver})")


async def _decide(fix_id: uuid.UUID, body: Decision, decision: str):
    async with db.transaction() as tx:
        row = await db.fix_for_update(tx, fix_id)
        if row is None:
            raise HTTPException(404, "fix not found")
        if row["issue_status"] != "fix_ready":
            raise HTTPException(409, "Fix already decided")
        fix = {"fix_id": str(row["fix_id"]), "fix_type": row["fix_type"], **row["patch"]}
        if decision == "approved":
            try:
                agent_config.check(fix, await db.get_design())  # config may have changed since the fix was drafted
            except agent_config.FixRejected as exc:
                raise HTTPException(409, f"fix no longer applies: {exc}") from exc
        approval = await db.insert_approval(tx, fix_id, decision, body.decided_by, body.note)
        await db.set_issue_status(tx, row["iid"], decision)
        if decision == "approved":
            await _apply_fix(tx, fix, body.decided_by)
    try:
        approval["meko_ref"] = await meko_client.record_approval(fix, approval)
        await db.set_meko_ref(approval["approval_id"], approval["meko_ref"])
    except Exception as exc:  # the decision stands even if the notebook is unreachable
        approval["meko_error"] = str(exc)
    approval["issue_id"] = str(row["iid"])
    await stream.publish("approval.recorded", approval)
    return approval


@router.post("/v1/fixes/{fix_id}/approve")
async def approve(fix_id: uuid.UUID, body: Decision):
    return await _decide(fix_id, body, "approved")


@router.post("/v1/fixes/{fix_id}/reject")
async def reject(fix_id: uuid.UUID, body: Decision):
    return await _decide(fix_id, body, "rejected")


@router.get("/v1/audit")
async def audit(limit: int = Query(50, ge=1, le=500)):
    return await db.audit(limit)
