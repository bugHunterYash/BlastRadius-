from fastapi import APIRouter, Depends

from app import db, pipeline, stream
from app.models import EventIn
from app.routers.deps import require_ingest_token

router = APIRouter(tags=["ingest"])


@router.post("/v1/events", dependencies=[Depends(require_ingest_token)])
async def ingest(ev: EventIn):
    """SDK ingest. Writes get their fact version back; posting the same event_id twice stores one event."""
    stored = await db.ingest_event(ev)
    if not stored["duplicate"]:
        await stream.publish("event.created", stored)
        if ev.op == "run_end":
            pipeline.enqueue(ev.run_id)
    return {"event_id": stored["event_id"], "version": stored["version"], "duplicate": stored["duplicate"]}
