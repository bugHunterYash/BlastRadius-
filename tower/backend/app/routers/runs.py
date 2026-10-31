from fastapi import APIRouter, HTTPException, Query

from app import db, pipeline

router = APIRouter(tags=["runs"])


@router.get("/v1/runs")
async def runs(limit: int = Query(20, ge=1, le=200)):
    return await db.list_runs(limit)


@router.get("/v1/runs/{run_id}")
async def run(run_id: str):
    r = await db.get_run(run_id)
    if r is None:
        raise HTTPException(404, "run not found")
    return r


@router.get("/v1/runs/{run_id}/events")
async def run_events(run_id: str):
    return await db.run_events(run_id)


@router.post("/v1/runs/{run_id}/analyse", status_code=202)
async def reanalyse(run_id: str):
    """Queue a run for analysis again (safe: issues and events never duplicate)."""
    if await db.get_run(run_id) is None:
        raise HTTPException(404, "run not found")
    pipeline.enqueue(run_id)
    return {"queued": run_id}
