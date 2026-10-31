"""PostgreSQL access through an asyncpg pool."""

import datetime as dt
import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg

from app.config import settings
from app.detectors.base import IssueDraft
from app.models import Ev, EventIn

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
pool: asyncpg.Pool | None = None

VERSION_SQL = """
INSERT INTO facts (fact_key, latest_version, updated_by, updated_at)
VALUES ($1, 1, $2, $3)
ON CONFLICT (fact_key) DO UPDATE
  SET latest_version = facts.latest_version + 1,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at
RETURNING latest_version
"""


async def _init_conn(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def init() -> None:
    global pool
    pool = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=10, init=_init_conn)
    async with pool.acquire() as c:
        for m in sorted(MIGRATIONS.glob("*.sql")):
            if not m.name.endswith(".down.sql"):  # rollbacks are applied by hand
                await c.execute(m.read_text(encoding="utf-8"))
        if await c.fetchval("SELECT count(*) FROM design_snapshots WHERE active") == 0 and settings.DESIGN_PATH.exists():
            await _save_design(c, json.loads(settings.DESIGN_PATH.read_text(encoding="utf-8")))


async def close() -> None:
    if pool:
        await pool.close()


@asynccontextmanager
async def transaction():
    async with pool.acquire() as c, c.transaction():
        yield c


def _out(r) -> dict:
    """Record -> JSON-friendly dict."""
    d = dict(r)
    for k, v in d.items():
        if isinstance(v, uuid.UUID):
            d[k] = str(v)
        elif isinstance(v, dt.datetime):
            d[k] = v.isoformat()
    return d


def _ev(r) -> Ev:
    return Ev(str(r["event_id"]), r["run_id"], r["agent"], r["op"], r["fact_key"], r["version"],
              r["value_preview"], r["target_agent"], r["ts"], r["reason"])


# ---------- ingest ----------

async def ingest_event(ev: EventIn) -> dict:
    """Store one event. Writes get the next fact version, assigned atomically. Duplicates are ignored."""
    async with transaction() as c:
        await c.execute(
            "INSERT INTO runs (run_id, datapack, scenario, started_at) VALUES ($1, $2, $3, $4) "
            "ON CONFLICT (run_id) DO NOTHING",
            ev.run_id, ev.datapack or settings.MEKO_DATAPACK, ev.scenario, ev.ts,
        )
        inserted = await c.fetchval(
            "INSERT INTO events (event_id, run_id, agent, op, fact_key, version, value_preview, target_agent, reason, "
            "ts, invocation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) "
            "ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
            ev.event_id, ev.run_id, ev.agent, ev.op, ev.fact_key,
            None if ev.op == "write" else ev.version, ev.value_preview, ev.target_agent, ev.reason, ev.ts,
            ev.invocation_id,
        )
        if inserted is None:
            row = await c.fetchrow("SELECT * FROM events WHERE event_id = $1", ev.event_id)
            return {**_out(row), "duplicate": True}
        if ev.op == "write":
            version = await c.fetchval(VERSION_SQL, ev.fact_key, ev.agent, ev.ts)
            await c.execute("UPDATE events SET version = $2 WHERE event_id = $1", ev.event_id, version)
        elif ev.op == "run_start":
            await c.execute(
                "UPDATE runs SET status = 'running', started_at = $2, scenario = COALESCE($3, scenario) WHERE run_id = $1",
                ev.run_id, ev.ts, ev.scenario,
            )
        elif ev.op == "run_end":
            await c.execute("UPDATE runs SET ended_at = $2 WHERE run_id = $1", ev.run_id, ev.ts)
        row = await c.fetchrow("SELECT * FROM events WHERE event_id = $1", ev.event_id)
    return {**_out(row), "duplicate": False}


# ---------- runs and events ----------

async def set_run_status(run_id: str, status: str) -> None:
    await pool.execute("UPDATE runs SET status = $2 WHERE run_id = $1", run_id, status)


async def get_run(run_id: str) -> dict | None:
    r = await pool.fetchrow("SELECT * FROM runs WHERE run_id = $1", run_id)
    return _out(r) if r else None


async def list_runs(limit: int) -> list[dict]:
    rows = await pool.fetch(
        """SELECT r.*,
                  count(i.issue_id) AS issues,
                  count(i.issue_id) FILTER (WHERE i.status IN ('open', 'fix_ready')) AS open_issues,
                  (SELECT count(*) FROM events e WHERE e.run_id = r.run_id) AS events
           FROM runs r LEFT JOIN issues i ON i.run_id = r.run_id
           GROUP BY r.run_id ORDER BY r.started_at DESC LIMIT $1""",
        limit,
    )
    return [_out(r) for r in rows]


async def run_events(run_id: str) -> list[dict]:
    rows = await pool.fetch("SELECT * FROM events WHERE run_id = $1 ORDER BY ts, received_at", run_id)
    return [_out(r) for r in rows]


async def load_run_context(run_id: str) -> tuple[list[Ev], dict, dict[str, int], str | None]:
    rows = await pool.fetch("SELECT * FROM events WHERE run_id = $1 ORDER BY ts, received_at", run_id)
    prior = await pool.fetch(
        """SELECT fact_key, max(version) AS v FROM events
           WHERE op = 'write' AND run_id <> $1
             AND ts < (SELECT min(ts) FROM events WHERE run_id = $1)
           GROUP BY fact_key""",
        run_id,
    )
    scenario = await pool.fetchval("SELECT scenario FROM runs WHERE run_id = $1", run_id)
    return [_ev(r) for r in rows], await get_design(), {r["fact_key"]: r["v"] for r in prior}, scenario


def as_rows(events: list[Ev] | list[dict]) -> list[str]:
    """Compact one-line-per-event format used for both LLMs."""
    out = []
    for e in events:
        g = (lambda k: e[k]) if isinstance(e, dict) else (lambda k: getattr(e, k))
        ts = g("ts")
        ts = (dt.datetime.fromisoformat(ts) if isinstance(ts, str) else ts).strftime("%H:%M:%S")
        op = g("op")
        if op in ("read", "write"):
            what = f"{g('fact_key')} v{g('version')}"
            if op == "write" and g("value_preview"):
                what += f'  "{g("value_preview")[:80]}"'
        elif op == "handoff":
            what = f"-> {g('target_agent')}"
        else:
            what = ""
        line = f"{ts}  {g('agent'):<10}  {op.upper():<9}  {what}".rstrip()
        if g("reason"):
            line += f"  | why: {g('reason')}"
        out.append(line)
    return out


# ---------- design ----------

async def _save_design(c, spec: dict) -> dict:
    await c.execute("UPDATE design_snapshots SET active = false WHERE active")
    row = await c.fetchrow(
        "INSERT INTO design_snapshots (design_id, spec) VALUES ($1, $2) RETURNING *", uuid.uuid4(), spec
    )
    return _out(row)


async def save_design(spec: dict, conn=None) -> dict:
    if conn is not None:
        return await _save_design(conn, spec)
    async with transaction() as c:
        return await _save_design(c, spec)


async def get_design() -> dict:
    spec = await pool.fetchval(
        "SELECT spec FROM design_snapshots WHERE active ORDER BY created_at DESC LIMIT 1"
    )
    return spec or {"agents": [], "handoffs": [], "must_pass_through": {}, "permissions": {}}


async def design_history(limit: int = 20) -> list[dict]:
    rows = await pool.fetch(
        "SELECT design_id, active, created_at FROM design_snapshots ORDER BY created_at DESC LIMIT $1", limit
    )
    return [_out(r) for r in rows]


# ---------- issues ----------

async def insert_issues(run_id: str, drafts: list[IssueDraft]) -> list[dict]:
    created = []
    async with pool.acquire() as c:
        for d in drafts:
            row = await c.fetchrow(
                "INSERT INTO issues (issue_id, run_id, type, agent, fact_key, evidence, detail) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7) "
                "ON CONFLICT (run_id, type, agent, fact_key) DO NOTHING RETURNING *",
                uuid.uuid4(), run_id, d.type, d.agent, d.fact_key, [e for e in d.evidence if e], d.detail,
            )
            if row:
                created.append(_out(row))
    return created


async def set_issue_note(issue_id: str, note: str) -> None:
    await pool.execute("UPDATE issues SET note = $2 WHERE issue_id = $1", uuid.UUID(issue_id), note)


async def verify_approved(run_id: str, scenario: str | None, drafts: list[IssueDraft]) -> list[dict]:
    """Close the loop: approved issues from earlier runs of the same scenario are resolved if this
    run no longer shows them, or reopened if it does."""
    if not scenario:
        return []
    seen = {(d.type, d.agent, d.fact_key) for d in drafts}
    rows = await pool.fetch(
        """SELECT i.* FROM issues i JOIN runs r ON r.run_id = i.run_id
           WHERE r.scenario = $1 AND i.run_id <> $2 AND i.status = 'approved'""",
        scenario, run_id,
    )
    updated = []
    for r in rows:
        held = (r["type"], r["agent"], r["fact_key"]) not in seen
        status = "resolved" if held else "open"
        note = f"verified clean in {run_id}" if held else f"fix did not hold: seen again in {run_id}"
        row = await pool.fetchrow(
            "UPDATE issues SET status = $2, note = $3 WHERE issue_id = $1 RETURNING *", r["issue_id"], status, note
        )
        updated.append(_out(row))
    return updated


def _fix_out(f) -> dict | None:
    if f is None:
        return None
    patch = f["patch"] or {}
    return {"fix_id": str(f["fix_id"]), "explanation": f["explanation"], "fix_type": f["fix_type"],
            "model": f["model"], "created_at": f["created_at"].isoformat(), **patch}


async def _latest_fix(c, issue_id) -> dict | None:
    return _fix_out(await c.fetchrow(
        "SELECT * FROM fixes WHERE issue_id = $1 ORDER BY created_at DESC LIMIT 1", issue_id
    ))


async def list_issues(status: str | None, run_id: str | None, limit: int = 200) -> list[dict]:
    rows = await pool.fetch(
        """SELECT * FROM issues
           WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR run_id = $2)
           ORDER BY created_at DESC LIMIT $3""",
        status, run_id, limit,
    )
    out = []
    async with pool.acquire() as c:
        for r in rows:
            out.append({**_out(r), "fix": await _latest_fix(c, r["issue_id"])})
    return out


async def get_issue(issue_id: uuid.UUID) -> dict | None:
    async with pool.acquire() as c:
        r = await c.fetchrow("SELECT * FROM issues WHERE issue_id = $1", issue_id)
        if not r:
            return None
        ids = [uuid.UUID(e) for e in r["evidence"]]
        ev = await c.fetch("SELECT * FROM events WHERE event_id = ANY($1::uuid[]) ORDER BY ts", ids)
        fix = await _latest_fix(c, issue_id)
        approval = None
        if fix:
            a = await c.fetchrow(
                "SELECT * FROM approvals WHERE fix_id = $1 ORDER BY decided_at DESC LIMIT 1", uuid.UUID(fix["fix_id"])
            )
            approval = _out(a) if a else None
    return {**_out(r), "evidence": [_out(e) for e in ev], "fix": fix, "approval": approval}


# ---------- fixes and approvals ----------

async def past_fixes(issue_type: str, limit: int = 5) -> list[dict]:
    rows = await pool.fetch(
        """SELECT f.fix_type, f.patch, f.explanation, a.decision, a.note
           FROM fixes f JOIN issues i ON i.issue_id = f.issue_id JOIN approvals a ON a.fix_id = f.fix_id
           WHERE i.type = $1 ORDER BY a.decided_at DESC LIMIT $2""",
        issue_type, limit,
    )
    return [dict(r) for r in rows]


async def insert_fix(issue: dict, proposal: dict, model: str) -> dict:
    patch = {k: proposal[k] for k in ("target_agent", "before", "after", "risk", "verify_by")}
    async with transaction() as c:
        f = await c.fetchrow(
            "INSERT INTO fixes (fix_id, issue_id, explanation, fix_type, patch, model) "
            "VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            uuid.uuid4(), uuid.UUID(issue["issue_id"]), proposal["explanation"], proposal["fix_type"], patch, model,
        )
        await c.execute(
            "UPDATE issues SET status = 'fix_ready' WHERE issue_id = $1 AND status = 'open'", uuid.UUID(issue["issue_id"])
        )
    return {"issue_id": issue["issue_id"], "fix": _fix_out(f)}


async def fix_for_update(c, fix_id: uuid.UUID):
    return await c.fetchrow(
        """SELECT f.*, i.status AS issue_status, i.issue_id AS iid
           FROM fixes f JOIN issues i ON i.issue_id = f.issue_id
           WHERE f.fix_id = $1 FOR UPDATE""",
        fix_id,
    )


async def insert_approval(c, fix_id, decision: str, decided_by: str, note: str | None) -> dict:
    row = await c.fetchrow(
        "INSERT INTO approvals (approval_id, fix_id, decision, decided_by, note) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING *",
        uuid.uuid4(), fix_id, decision, decided_by, note,
    )
    return _out(row)


async def set_issue_status(c, issue_id, status: str) -> None:
    await c.execute("UPDATE issues SET status = $2 WHERE issue_id = $1", issue_id, status)


async def set_meko_ref(approval_id: str, ref: str) -> None:
    await pool.execute("UPDATE approvals SET meko_ref = $2 WHERE approval_id = $1", uuid.UUID(approval_id), ref)


async def audit(limit: int) -> list[dict]:
    rows = await pool.fetch(
        """SELECT a.*, f.fix_type, f.patch, f.explanation, f.model, i.issue_id, i.type, i.agent, i.fact_key, i.run_id
           FROM approvals a JOIN fixes f ON f.fix_id = a.fix_id JOIN issues i ON i.issue_id = f.issue_id
           ORDER BY a.decided_at DESC LIMIT $1""",
        limit,
    )
    return [_out(r) for r in rows]


# ---------- digests and timeline ----------

async def insert_digest(run_id: str, digest: dict, model: str) -> dict:
    row = await pool.fetchrow(
        "INSERT INTO digests (digest_id, run_id, summary, model) VALUES ($1, $2, $3, $4) RETURNING *",
        uuid.uuid4(), run_id, json.dumps(digest), model,
    )
    return _digest_out(row)


def _digest_out(r) -> dict:
    d = _out(r)
    d["summary"] = json.loads(d["summary"])
    return d


async def timeline_events(agent, fact_key, since, until, run_id=None, limit: int = 500) -> list[dict]:
    rows = await pool.fetch(
        """SELECT * FROM events
           WHERE op IN ('read', 'write', 'handoff')
             AND ($1::text IS NULL OR agent = $1) AND ($2::text IS NULL OR fact_key = $2)
             AND ($3::timestamptz IS NULL OR ts >= $3) AND ($4::timestamptz IS NULL OR ts <= $4)
             AND ($5::text IS NULL OR run_id = $5)
           ORDER BY ts DESC LIMIT $6""",
        agent, fact_key, since, until, run_id, limit,
    )
    return [_out(r) for r in reversed(rows)]


async def digests(run_id: str | None, limit: int = 20) -> list[dict]:
    rows = await pool.fetch(
        "SELECT * FROM digests WHERE ($1::text IS NULL OR run_id = $1) ORDER BY created_at DESC LIMIT $2",
        run_id, limit,
    )
    return [_digest_out(r) for r in rows]


# ---------- blast radius ----------

async def blast_radius(event_id: uuid.UUID, max_hops: int = 5) -> dict | None:
    """Everything one write touched: later reads of that exact version, then what those agents
    wrote afterwards in the same run, up to max_hops."""
    root = await pool.fetchrow("SELECT * FROM events WHERE event_id = $1", event_id)
    if root is None:
        return None
    events = [_ev(r) for r in await pool.fetch(
        "SELECT * FROM events WHERE run_id = $1 ORDER BY ts, received_at", root["run_id"]
    )]
    index = {e.event_id: i for i, e in enumerate(events)}

    def node(e: Ev, hop: int) -> dict:
        return {"id": e.event_id, "agent": e.agent, "op": e.op, "fact_key": e.fact_key,
                "version": e.version, "ts": e.ts.isoformat(), "hop": hop}

    root_ev = events[index[str(event_id)]]
    nodes, edges = {root_ev.event_id: node(root_ev, 0)}, []
    frontier = [root_ev] if root_ev.op == "write" else []
    hop = 0
    while frontier and hop < max_hops:
        hop += 1
        nxt = []
        for w in frontier:
            for r in events[index[w.event_id] + 1:]:
                if r.op != "read" or r.fact_key != w.fact_key or r.version != w.version:
                    continue
                if r.event_id not in nodes:
                    nodes[r.event_id] = node(r, hop)
                edges.append({"from": w.event_id, "to": r.event_id})
                for out in events[index[r.event_id] + 1:]:
                    if out.op == "write" and out.agent == r.agent:
                        if out.event_id not in nodes:
                            nodes[out.event_id] = node(out, hop)
                            nxt.append(out)
                        edges.append({"from": r.event_id, "to": out.event_id})
        frontier = nxt
    unique_edges = list({(e["from"], e["to"]): e for e in edges}.values())
    return {"root": root_ev.event_id, "run_id": root_ev.run_id, "nodes": list(nodes.values()), "edges": unique_edges}


# ---------- local notebook (Meko stand-in) ----------

async def notebook_write(item_id: uuid.UUID, datapack: str, kind: str, text: str) -> None:
    await pool.execute(
        "INSERT INTO notebook_items (item_id, datapack, kind, text) VALUES ($1, $2, $3, $4)",
        item_id, datapack, kind, text,
    )


async def notebook_search(datapack: str, query: str | None, limit: int) -> list[dict]:
    rows = await pool.fetch(
        """SELECT * FROM notebook_items
           WHERE datapack = $1 AND ($2::text IS NULL OR strpos(text, $2) > 0)
           ORDER BY created_at DESC LIMIT $3""",
        datapack, query or None, limit,
    )
    return [_out(r) for r in rows]


async def health() -> bool:
    return await pool.fetchval("SELECT 1") == 1
