"""Version assignment and ingest idempotency against a real database."""

import asyncio
import datetime as dt
import uuid

from app import db
from app.models import EventIn


def _ev(op: str, **kw) -> EventIn:
    return EventIn(event_id=uuid.uuid4(), run_id=kw.pop("run_id", "r1"), agent=kw.pop("agent", "researcher"),
                   op=op, ts=dt.datetime.now(dt.timezone.utc), **kw)


async def _with_db(fn):
    await db.init()
    try:
        return await fn()
    finally:
        await db.close()


def test_concurrent_writes_get_versions_1_to_20(fresh_db):
    async def go():
        await db.ingest_event(_ev("run_start"))
        results = await asyncio.gather(*(db.ingest_event(_ev("write", fact_key="price")) for _ in range(20)))
        return sorted(r["version"] for r in results)

    assert asyncio.run(_with_db(go)) == list(range(1, 21))


def test_same_event_twice_is_stored_once(fresh_db):
    async def go():
        ev = _ev("write", fact_key="price")
        first, second = await db.ingest_event(ev), await db.ingest_event(ev)
        count = await db.pool.fetchval("SELECT count(*) FROM events WHERE event_id = $1", ev.event_id)
        latest = await db.pool.fetchval("SELECT latest_version FROM facts WHERE fact_key = 'price'")
        return first, second, count, latest

    first, second, count, latest = asyncio.run(_with_db(go))
    assert (first["duplicate"], second["duplicate"]) == (False, True)
    assert first["version"] == second["version"] == 1
    assert count == 1 and latest == 1  # the duplicate did not bump the version


def test_design_is_seeded_from_design_json(fresh_db):
    spec = asyncio.run(_with_db(db.get_design))
    assert spec["agents"] == ["researcher", "writer", "reviewer", "publisher", "analyst"]
