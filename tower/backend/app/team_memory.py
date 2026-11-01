"""The shared memory of a project run: each agent reads what the agents before it wrote, and writes its own findings.

The tower does the reading and writing around each agent's task, so it works the same for every runtime
(Claude, Codex, Antigravity) and every call is recorded as a memory event with its version:
  before a task:  recall()   reads the latest version of each fact this agent may read, written earlier in the run
  after a task:   remember() writes the agent's answer as its fact, then hands off to the next agent
The text goes to Meko (or the local notebook when Meko isn't configured); a copy stays in Postgres so the
run never depends on Meko being reachable. The detectors then check these events like any other run's.
"""

import datetime as dt
import logging
import uuid

from app import db, meko_client, pipeline, stream
from app.models import EventIn

log = logging.getLogger("tower.team_memory")
MAX_RECALL = 1500        # characters of each fact put in the next agent's prompt
MAX_TEXT = 4000          # characters of an answer kept as the fact


def output_key(agent: str, design: dict) -> str:
    """The fact an agent's findings are written to: the last one the design lets it write."""
    keys = design.get("permissions", {}).get(agent, {}).get("write") or []
    return keys[-1] if keys else agent


async def emit(run_id: str, agent: str, op: str, *, invocation_id: str | None = None, **fields) -> dict:
    """Store one memory event exactly as SDK ingest would, and publish it."""
    ev = EventIn(event_id=uuid.uuid4(), run_id=run_id, agent=agent, op=op, ts=dt.datetime.now(dt.timezone.utc),
                 invocation_id=uuid.UUID(invocation_id) if invocation_id else None, **fields)
    stored = await db.ingest_event(ev)
    await stream.publish("event.created", stored)
    if op == "run_end":
        pipeline.enqueue(run_id)
    return stored


async def recall(run_id: str, agent: str, design: dict) -> tuple[str, list[str]]:
    """Read every fact this agent may read that an earlier agent in this run wrote.
    Returns the block for the agent's prompt and the read events' ids (tied to its task once it exists)."""
    keys = design.get("permissions", {}).get(agent, {}).get("read") or []
    if not keys:
        return "", []
    rows = await db.pool.fetch(
        """SELECT DISTINCT ON (fact_key) fact_key, version, agent, meko_ref, text FROM team_memory
           WHERE run_id = $1 AND fact_key = ANY($2::text[]) ORDER BY fact_key, version DESC""",
        run_id, keys)
    parts, ids = [], []
    for r in rows:
        text = r["text"]
        if r["meko_ref"]:
            try:                                  # read the shared copy; the local one stands in if Meko is down
                text = await meko_client.read(r["meko_ref"]) or text
            except Exception as exc:
                log.warning("meko read failed for %s: %s", r["meko_ref"], exc)
        ev = await emit(run_id, agent, "read", fact_key=r["fact_key"], version=r["version"],
                        reason=f"Read {r['fact_key']} v{r['version']} from {r['agent']} before starting")
        ids.append(ev["event_id"])
        parts.append(f"## {r['fact_key']} (v{r['version']}, by {r['agent']})\n{text[:MAX_RECALL]}")
    if not parts:
        return "", []
    return ("\n\nShared memory from the agents before you (read it, build on it, don't redo it):\n\n"
            + "\n\n".join(parts)), ids


async def tie_reads(event_ids: list[str], invocation_id: str) -> None:
    """Link the reads made for a task to that task, once it has an id."""
    if event_ids:
        await db.pool.execute("UPDATE events SET invocation_id = $1 WHERE event_id = ANY($2::uuid[])",
                              uuid.UUID(invocation_id), [uuid.UUID(i) for i in event_ids])


async def remember(run_id: str, agent: str, text: str, design: dict, *, invocation_id: str | None,
                   next_agent: str | None) -> dict:
    """Write an agent's findings as its fact (Meko + Postgres), then hand off to the next agent."""
    key = output_key(agent, design)
    text = text.strip()[:MAX_TEXT]
    ref = None
    try:
        ref = await meko_client.write(f"[{run_id}] {agent} wrote {key}:\n{text}", kind="finding")
    except Exception as exc:
        log.warning("meko write failed for %s/%s: %s", run_id, agent, exc)
    stored = await emit(run_id, agent, "write", invocation_id=invocation_id, fact_key=key,
                        value_preview=text[:200], reason=f"Saved its findings as {key}")
    await db.pool.execute(
        "INSERT INTO team_memory (event_id, run_id, agent, fact_key, version, meko_ref, text) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        uuid.UUID(stored["event_id"]), run_id, agent, key, stored["version"], ref, text)
    if next_agent and next_agent != agent:
        await emit(run_id, agent, "handoff", invocation_id=invocation_id, target_agent=next_agent,
                   reason=f"Done; {key} is ready for {next_agent}")
    return {"fact_key": key, "version": stored["version"], "meko_ref": ref}
