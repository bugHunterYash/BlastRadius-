import datetime as dt

from fastapi import APIRouter, Depends

from app import db
from app.agents import summarizer
from app.models import AskBody
from app.routers.deps import ask_rate_limit

router = APIRouter(tags=["timeline"])


@router.get("/v1/timeline")
async def timeline(agent: str | None = None, fact_key: str | None = None, run_id: str | None = None,
                   since: dt.datetime | None = None, until: dt.datetime | None = None):
    return {
        "events": await db.timeline_events(agent, fact_key, since, until, run_id),
        "digests": await db.digests(run_id),
    }


@router.post("/v1/timeline/ask", dependencies=[Depends(ask_rate_limit)])
async def ask(body: AskBody):
    """Filter with SQL first, then let the Summarizer answer from those rows only."""
    events = await db.timeline_events(body.agent, body.fact_key, body.since, body.until)
    return {**await summarizer.answer(body.question, db.as_rows(events)), "rows": len(events)}
