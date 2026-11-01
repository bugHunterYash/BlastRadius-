from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import briefs, db, pipeline, projects
from app.runtime import router as agent_router

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


class Part(BaseModel):
    agent: str = Field(min_length=1, max_length=100)
    task: str = Field(min_length=1, max_length=4000)
    label: str | None = Field(default=None, max_length=60)


class NewProject(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["content", "website", "software", "research", "training", "finetune"] = "software"
    goal: str = Field(min_length=1, max_length=2000)
    deliverable: str | None = Field(default=None, max_length=60)
    folder: str | None = Field(default=None, max_length=1000)
    tasks: list[Part] = Field(min_length=1, max_length=10)
    allow_edits: bool = False
    in_order: bool = False      # each part waits for the one before and reads its findings


@router.post("/v1/project-runs", status_code=201)
async def new_project(body: NewProject):
    """Start a project: a run with its brief, and each agent's part sent to it (read-only unless edits are allowed)."""
    try:
        return await briefs.start(name=body.name.strip(), kind=body.kind, goal=body.goal.strip(), deliverable=body.deliverable,
                                  folder=body.folder, tasks=[t.model_dump() for t in body.tasks], allow_edits=body.allow_edits,
                                  in_order=body.in_order)
    except projects.ProjectError as exc:
        raise HTTPException(422, str(exc)) from exc
    except agent_router.RoutingError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.get("/v1/runs/{run_id}/brief")
async def brief(run_id: str):
    b = await briefs.get(run_id)
    if b is None:
        raise HTTPException(404, "this run has no brief")
    return b


@router.get("/v1/runs/{run_id}/report")
async def report(run_id: str):
    """The agents' real work in a run, for the session report: each task, answer, model, tokens, steps and timing."""
    data = await briefs.report_data(run_id)
    if data is None:
        raise HTTPException(404, "run not found")
    return data
