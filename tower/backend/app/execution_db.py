"""PostgreSQL access for agent sessions, invocations and their ordered execution events."""

import datetime as dt
import json
import uuid

from app import db
from app.config import settings

TERMINAL = ("completed", "failed", "cancelled", "timeout")


def _out(r) -> dict:
    return db._out(r)


async def ensure_run(conn, run_id: str) -> None:
    await conn.execute(
        "INSERT INTO runs (run_id, datapack) VALUES ($1, $2) ON CONFLICT (run_id) DO NOTHING",
        run_id, settings.MEKO_DATAPACK,
    )


async def active_design_id() -> str | None:
    v = await db.pool.fetchval("SELECT design_id FROM design_snapshots WHERE active ORDER BY created_at DESC LIMIT 1")
    return str(v) if v else None


async def create_invocation(*, run_id: str, agent_id: str, provider: str, runtime: str, model: str | None,
                            workspace_id: str, why: str | None, system_prompt: str | None, user_prompt: str,
                            routing: dict, session_id: uuid.UUID | None,
                            idempotency_key: str | None) -> tuple[dict, bool]:
    """Returns (invocation, created). A repeated idempotency_key returns the existing invocation."""
    async with db.transaction() as c:
        if idempotency_key:
            row = await c.fetchrow("SELECT * FROM agent_invocations WHERE idempotency_key = $1", idempotency_key)
            if row:
                return _out(row), False
        await ensure_run(c, run_id)
        row = await c.fetchrow(
            """INSERT INTO agent_invocations (invocation_id, run_id, agent_id, session_id, provider, runtime, model,
                 workspace_id, why, system_prompt, user_prompt, routing, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *""",
            uuid.uuid4(), run_id, agent_id, session_id, provider, runtime, model, workspace_id, why,
            system_prompt, user_prompt, routing, idempotency_key,
        )
    return _out(row), True


async def append_event(invocation_id: str, event_type: str, why: str | None, payload: dict,
                       dedupe_key: str | None = None) -> dict | None:
    """Store one event with the next sequence number. Returns None if dedupe_key was already stored.
    The invocation row is locked, so concurrent appends get gap-free, ordered sequences."""
    iid = uuid.UUID(invocation_id)
    async with db.transaction() as c:
        await c.execute("SELECT 1 FROM agent_invocations WHERE invocation_id = $1 FOR UPDATE", iid)
        if dedupe_key and await c.fetchval(
            "SELECT 1 FROM agent_execution_events WHERE invocation_id = $1 AND dedupe_key = $2", iid, dedupe_key
        ):
            return None
        seq = await c.fetchval(
            "UPDATE agent_invocations SET last_sequence = last_sequence + 1 WHERE invocation_id = $1 "
            "RETURNING last_sequence", iid,
        )
        if seq is None:
            raise LookupError(f"invocation {invocation_id} not found")
        row = await c.fetchrow(
            """INSERT INTO agent_execution_events (event_id, invocation_id, sequence, event_type, why, payload, dedupe_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *""",
            uuid.uuid4(), iid, seq, event_type, why, payload, dedupe_key,
        )
    return _out(row)


async def append_events_bulk(invocation_id: str, events: list[tuple[str, str | None, dict]]) -> int:
    """Store many (event_type, why, payload) rows in one transaction with consecutive sequences
    (used by imports, where thousands of events arrive at once). Returns how many were stored."""
    if not events:
        return 0
    iid = uuid.UUID(invocation_id)
    async with db.transaction() as c:
        start = await c.fetchval(
            "UPDATE agent_invocations SET last_sequence = last_sequence + $2 WHERE invocation_id = $1 "
            "RETURNING last_sequence - $2", iid, len(events),
        )
        if start is None:
            raise LookupError(f"invocation {invocation_id} not found")
        await c.executemany(
            "INSERT INTO agent_execution_events (event_id, invocation_id, sequence, event_type, why, payload) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            [(uuid.uuid4(), iid, start + i + 1, t, why, payload) for i, (t, why, payload) in enumerate(events)],
        )
    return len(events)


async def mark_started(invocation_id: str) -> None:
    await db.pool.execute(
        "UPDATE agent_invocations SET status = 'running', started_at = clock_timestamp() "
        "WHERE invocation_id = $1 AND status = 'queued'", uuid.UUID(invocation_id),
    )


async def finalize(invocation_id: str, *, status: str, final_response: str | None, error_message: str | None,
                   provider_thread_id: str | None, provider_turn_id: str | None, input_tokens: int | None,
                   output_tokens: int | None, usage: dict | None, metadata: dict, session_id: uuid.UUID | None) -> dict:
    row = await db.pool.fetchrow(
        """UPDATE agent_invocations SET status = $2, final_response = $3, error_message = $4,
             provider_thread_id = COALESCE($5, provider_thread_id), provider_turn_id = COALESCE($6, provider_turn_id),
             input_tokens = $7, output_tokens = $8, usage = $9, metadata = metadata || $10,
             session_id = COALESCE($11, session_id), completed_at = clock_timestamp()
           WHERE invocation_id = $1 RETURNING *""",
        uuid.UUID(invocation_id), status, final_response, error_message, provider_thread_id, provider_turn_id,
        input_tokens, output_tokens, usage, metadata, session_id,
    )
    return _out(row)


async def upsert_session(*, run_id: str, agent_id: str, provider: str, provider_session_id: str,
                         workspace_id: str, status: str) -> uuid.UUID:
    async with db.transaction() as c:
        sid = await c.fetchval(
            "SELECT session_id FROM agent_sessions WHERE provider = $1 AND provider_session_id = $2",
            provider, provider_session_id,
        )
        if sid:
            await c.execute("UPDATE agent_sessions SET status = $2, updated_at = clock_timestamp() WHERE session_id = $1",
                            sid, status)
            return sid
        sid = uuid.uuid4()
        await c.execute(
            """INSERT INTO agent_sessions (session_id, run_id, agent_id, provider, provider_session_id, workspace_id, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            sid, run_id, agent_id, provider, provider_session_id, workspace_id, status,
        )
        return sid


async def get_session(session_id: uuid.UUID) -> dict | None:
    r = await db.pool.fetchrow("SELECT * FROM agent_sessions WHERE session_id = $1", session_id)
    return _out(r) if r else None


async def get_invocation(invocation_id: uuid.UUID) -> dict | None:
    r = await db.pool.fetchrow("SELECT * FROM agent_invocations WHERE invocation_id = $1", invocation_id)
    if r is None:
        return None
    inv = _out(r)
    counts = await db.pool.fetch(
        "SELECT event_type, count(*) AS n FROM agent_execution_events WHERE invocation_id = $1 GROUP BY event_type",
        invocation_id,
    )
    inv["event_counts"] = {c["event_type"]: c["n"] for c in counts}
    mem = await db.pool.fetch("SELECT * FROM events WHERE invocation_id = $1 ORDER BY ts", invocation_id)
    inv["memory_events"] = [_out(m) for m in mem]
    return inv


async def list_events(invocation_id: uuid.UUID, after_sequence: int = 0, limit: int = 500,
                      types: list[str] | None = None) -> list[dict]:
    rows = await db.pool.fetch(
        """SELECT * FROM agent_execution_events
           WHERE invocation_id = $1 AND sequence > $2 AND ($3::text[] IS NULL OR event_type = ANY($3))
           ORDER BY sequence LIMIT $4""",
        invocation_id, after_sequence, types, limit,
    )
    return [_out(r) for r in rows]


async def run_invocations(run_id: str, full: bool = False) -> list[dict]:
    """Invocations of a run, oldest first. full=True adds the complete prompt and answer (chat history)."""
    rows = await db.pool.fetch(
        """SELECT invocation_id, run_id, agent_id, session_id, provider, runtime, model, workspace_id, why, status,
                  error_message, provider_thread_id, provider_turn_id, input_tokens, output_tokens, last_sequence,
                  created_at, started_at, completed_at, left(user_prompt, 300) AS prompt_preview,
                  left(final_response, 300) AS response_preview,
                  CASE WHEN $2 THEN user_prompt END AS user_prompt,
                  CASE WHEN $2 THEN final_response END AS final_response
           FROM agent_invocations WHERE run_id = $1 ORDER BY created_at""",
        run_id, full,
    )
    return [_out(r) for r in rows]


async def execution_summary(run_id: str) -> dict:
    rows = await db.pool.fetch(
        "SELECT provider, status, count(*) AS n FROM agent_invocations WHERE run_id = $1 GROUP BY provider, status",
        run_id,
    )
    by_status: dict[str, int] = {}
    by_provider: dict[str, int] = {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + r["n"]
        by_provider[r["provider"]] = by_provider.get(r["provider"], 0) + r["n"]
    return {
        "total_invocations": sum(by_status.values()),
        "completed": by_status.get("completed", 0),
        "failed": by_status.get("failed", 0) + by_status.get("timeout", 0),
        "cancelled": by_status.get("cancelled", 0),
        "running": by_status.get("running", 0) + by_status.get("queued", 0),
        "by_provider": by_provider,
    }


SUMMARY_TYPES = ["invocation.started", "command.completed", "file.changed", "tool.started",
                 "invocation.completed", "invocation.failed", "invocation.cancelled"]


async def summary_rows(run_id: str, limit: int = 200) -> list[str]:
    """Execution rows in the Summarizer's one-line format: what each agent's runtime visibly did."""
    rows = await db.pool.fetch(
        """SELECT e.created_at, i.agent_id, i.provider, e.event_type, e.why, e.payload
           FROM agent_execution_events e JOIN agent_invocations i ON i.invocation_id = e.invocation_id
           WHERE i.run_id = $1 AND e.event_type = ANY($2) ORDER BY e.created_at LIMIT $3""",
        run_id, SUMMARY_TYPES, limit,
    )
    out = []
    for r in rows:
        p = r["payload"] or {}
        what = {
            "invocation.started": f"{r['provider']} task started",
            "command.completed": f"ran `{str(p.get('command'))[:80]}` exit={p.get('exit_code', 'err' if p.get('is_error') else 0)}",
            "file.changed": f"changed file {p.get('path')}",
            "tool.started": f"used tool {p.get('tool')}",
        }.get(r["event_type"], r["event_type"].replace("invocation.", "task "))
        line = f"{r['created_at'].strftime('%H:%M:%S')}  {r['agent_id']:<10}  {'EXEC':<9}  {what}"
        if r["why"]:
            line += f"  | why: {r['why'][:160]}"
        out.append(line)
    return out


async def invocations_for_issue(issue_id: uuid.UUID) -> list[dict]:
    """Invocations linked to an issue: through its evidence events, or the same run and agent."""
    rows = await db.pool.fetch(
        """SELECT DISTINCT i.invocation_id, i.agent_id, i.provider, i.status, left(i.user_prompt, 500) AS prompt,
                  left(i.final_response, 500) AS response, i.created_at
           FROM issues s
           JOIN agent_invocations i ON i.run_id = s.run_id
           LEFT JOIN events e ON e.invocation_id = i.invocation_id
                             AND e.event_id = ANY(SELECT jsonb_array_elements_text(s.evidence)::uuid)
           WHERE s.issue_id = $1 AND (e.event_id IS NOT NULL OR i.agent_id = s.agent)
           ORDER BY i.created_at""",
        issue_id,
    )
    return [_out(r) for r in rows]


async def recent_actions(invocation_ids: list[str], limit: int = 15) -> list[str]:
    if not invocation_ids:
        return []
    rows = await db.pool.fetch(
        """SELECT e.sequence, i.agent_id, e.event_type, e.why, e.payload FROM agent_execution_events e
           JOIN agent_invocations i ON i.invocation_id = e.invocation_id
           WHERE e.invocation_id = ANY($1::uuid[]) AND e.event_type IN ('tool.started', 'command.completed', 'file.changed')
           ORDER BY e.created_at DESC LIMIT $2""",
        [uuid.UUID(i) for i in invocation_ids], limit,
    )
    return [f"{r['agent_id']} {r['event_type']} {json.dumps(r['payload'])[:200]}" + (f" | why: {r['why']}" if r["why"] else "")
            for r in reversed(rows)]


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()
