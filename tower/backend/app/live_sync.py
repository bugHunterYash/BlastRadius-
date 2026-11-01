"""Live sync: chats you have in the Claude app / Claude Code and in the Codex app show up in the tower
by themselves, as they happen.

Every LIVE_SYNC_INTERVAL_S seconds:
  Claude       local session transcripts (claude-agent-sdk list_sessions / get_session_messages)
  Codex        threads from the Codex app-server (thread/list, then thread/read with includeTurns)
  Antigravity  its local chat index (~/.gemini/antigravity/conversation_summaries.db, read-only)
Each session or thread becomes one invocation in its own run ("claude-session-<id8>" /
"codex-thread-<id8>"). Only steps that are new since the last pass are appended, and a
`sync.updated` event goes out on /v1/stream. Sessions and threads the tower started itself are
skipped (they are already recorded as live invocations). Read-only: nothing is sent to either app.
"""

import asyncio
import contextlib
import datetime as dt
import json
import logging
import uuid
import re
import sqlite3
import urllib.parse
from pathlib import Path

from app import db, execution_db as xdb, stream
from app.config import settings
from app.runtime.base import RuntimeError_
from app.runtime.codex_app_server import CLIENT_INFO, JsonRpcConnection, codex_argv
from app.runtime.redact import MAX_PROMPT, redact, redact_text
from app.session_import import normalize as normalize_claude

log = logging.getLogger("tower.live_sync")
CLAUDE_RUNTIME, CODEX_RUNTIME, AGY_RUNTIME = "claude_code_import", "codex_app_import", "antigravity_app_import"
ACTIVE_WINDOW_S = 90          # touched this recently = still "running"
CODEX_SOURCES = ["cli", "vscode", "exec", "appServer", "unknown"]


async def _tower_thread_ids() -> set[str]:
    """Sessions/threads the tower itself ran (live invocations), so they aren't synced twice."""
    rows = await db.pool.fetch(
        "SELECT provider_thread_id FROM agent_invocations WHERE runtime IN ('claude_agent_sdk', 'codex_app_server', 'antigravity_cli') "
        "AND provider_thread_id IS NOT NULL")
    return {r["provider_thread_id"] for r in rows}


async def _existing(key: str) -> dict | None:
    r = await db.pool.fetchrow("SELECT * FROM agent_invocations WHERE idempotency_key = $1", key)
    return db._out(r) if r else None


def _recent(updated_s: float | None) -> bool:
    return bool(updated_s) and (dt.datetime.now(dt.timezone.utc).timestamp() - updated_s) < ACTIVE_WINDOW_S


async def _unchanged(inv: dict | None, updated_s: float | None) -> bool:
    """Nothing new since the last pass. A running one whose time window has passed is marked idle here,
    without reading its history again."""
    if not inv or (inv.get("metadata") or {}).get("updated_s") != updated_s:
        return False
    if inv["status"] == "running" and not _recent(updated_s):
        await db.pool.execute("UPDATE agent_invocations SET status = 'completed' WHERE invocation_id = $1",
                              uuid.UUID(inv["invocation_id"]))
        await stream.publish("sync.updated", {"run_id": inv["run_id"], "invocation_id": inv["invocation_id"],
                                              "provider": inv["provider"], "agent_id": inv["agent_id"],
                                              "new_events": 0, "active": False, "title": (inv.get("metadata") or {}).get("title")})
    return True


async def _upsert(*, key: str, run_id: str, agent_id: str, provider: str, runtime: str, model: str | None,
                  first_prompt: str | None, final: str | None, events: list[tuple[str, str | None, dict]],
                  thread_id: str, updated_s: float | None, usage: dict | None, meta: dict,
                  active: bool | None = None) -> dict | None:
    """Create or extend the invocation for one external session. Returns a change summary, or None."""
    inv = await _existing(key)
    if inv is None:
        inv, _ = await xdb.create_invocation(
            run_id=run_id, agent_id=agent_id, provider=provider, runtime=runtime, model=model, workspace_id="imported",
            why=None, system_prompt=None, user_prompt=redact_text(first_prompt or "(no text prompt)", MAX_PROMPT),
            routing={"source": f"live sync from the {provider} app", "launched_by_tower": False},
            session_id=None, idempotency_key=key)
        await xdb.append_events_bulk(inv["invocation_id"], [("session.started", None, {"session_id": thread_id, "model": model, "synced": True})])
        done = 0
    else:
        # a session imported by hand already holds session.started + its events
        done = int((inv.get("metadata") or {}).get("synced_events", (inv.get("last_sequence") or 1) - 1))
        if (inv.get("metadata") or {}).get("updated_s") == updated_s and done == len(events) and inv["status"] != "running":
            return None
    new = events[done:]
    if new:
        await xdb.append_events_bulk(inv["invocation_id"], [(t, redact_text(w, 500) if w else None, redact(p)) for t, w, p in new])
    if active is None:
        active = _recent(updated_s)
    sid = await xdb.upsert_session(run_id=run_id, agent_id=agent_id, provider=provider, provider_session_id=thread_id,
                                   workspace_id="imported", status="active" if active else "synced")
    await xdb.finalize(
        inv["invocation_id"], status="running" if active else "completed",
        final_response=redact_text(final, MAX_PROMPT) if final else None, error_message=None,
        provider_thread_id=thread_id, provider_turn_id=None,
        input_tokens=(usage or {}).get("input_tokens"), output_tokens=(usage or {}).get("output_tokens"),
        usage=usage, session_id=sid, metadata=redact({**meta, "synced_events": len(events), "updated_s": updated_s}))
    return {"run_id": run_id, "invocation_id": inv["invocation_id"], "provider": provider, "agent_id": agent_id,
            "new_events": len(new), "active": active, "title": meta.get("title")}


# ---------- Claude ----------

async def sync_claude(skip: set[str]) -> list[dict]:
    from claude_agent_sdk import get_session_messages, list_sessions

    changes = []
    sessions = await asyncio.to_thread(list_sessions, settings.LIVE_SYNC_CLAUDE_DIR or None, settings.LIVE_SYNC_LIMIT)
    for s in sessions:
        if s.session_id in skip or _under(s.cwd, settings.AGENT_WORKSPACE_ROOT):
            continue
        key = f"import:claude:{s.session_id}"
        inv = await _existing(key)                    # imported by hand earlier: keep that one live
        if inv is None:
            key = f"sync:claude:{s.session_id}"
            inv = await _existing(key)
        updated_s = int(s.last_modified) / 1000 if s.last_modified else None
        if await _unchanged(inv, updated_s):
            continue
        messages = await asyncio.to_thread(get_session_messages, s.session_id, None, None)
        events, summary = normalize_claude(messages)
        change = await _upsert(
            key=key, run_id=f"claude-session-{s.session_id[:8]}", agent_id="claude-code", provider="claude",
            runtime=CLAUDE_RUNTIME, model=summary["model"], first_prompt=summary["first_prompt"],
            final=summary["final_response"], events=events, thread_id=s.session_id, updated_s=updated_s,
            usage=summary["usage"], meta={"title": s.custom_title or s.summary, "cwd": s.cwd, "git_branch": s.git_branch,
                                          "imported": True, "app": "claude"})
        if change:
            changes.append(change)
    return changes


# ---------- Codex ----------

def normalize_codex(thread: dict) -> tuple[list[tuple[str, str | None, dict]], dict]:
    """A thread's turns -> the same event types as live capture. Reasoning items are not stored."""
    events: list[tuple[str, str | None, dict]] = []
    first, last_text = None, None
    for turn in thread.get("turns") or []:
        items = turn.get("items") or []
        if turn.get("status") == "inProgress" and items and items[-1].get("type") == "agentMessage":
            items = items[:-1]                # still being written
        for item in items:
            kind, iid = item.get("type"), item.get("id")
            if item.get("status") == "inProgress":
                break                         # the rest of this turn comes in a later pass, finished
            if kind == "userMessage":
                text = "\n".join(c.get("text", "") for c in item.get("content") or [] if isinstance(c, dict) and c.get("type") == "text")
                if text.strip():
                    first = first or text
                    events.append(("prompt.received", None, {"prompt": text, "item_id": iid}))
            elif kind == "agentMessage" and (item.get("text") or "").strip():
                last_text = item["text"]
                events.append(("message.completed", None, {"text": item["text"], "item_id": iid}))
            elif kind == "commandExecution":
                why = last_text[:300] if last_text else None
                events.append(("command.started", why, {"item_id": iid, "command": item.get("command"), "cwd": item.get("cwd")}))
                events.append(("command.completed", None, {"item_id": iid, "command": item.get("command"), "status": item.get("status"),
                                                            "exit_code": item.get("exitCode"), "output": item.get("aggregatedOutput")}))
            elif kind == "fileChange":
                for c in item.get("changes") or []:
                    events.append(("file.changed", None, {"item_id": iid, "path": c.get("path"), "kind": (c.get("kind") or {}).get("type"),
                                                          "diff": c.get("diff"), "status": item.get("status")}))
            elif kind in ("mcpToolCall", "dynamicToolCall", "webSearch"):
                why = last_text[:300] if last_text else None
                events.append(("tool.started", why, {"item_id": iid, "tool": item.get("tool") or kind,
                                                      "input": item.get("arguments") if "arguments" in item else item.get("query")}))
                events.append(("tool.completed", None, {"item_id": iid, "tool": item.get("tool") or kind, "status": item.get("status")}))
    return events, {"first_prompt": first, "final_response": last_text}


SHELL_TOOLS = {"shell", "shell_command", "exec_command", "local_shell"}


def _text(content) -> str:
    return "\n".join(c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("text"))


def normalize_rollout(lines) -> tuple[list[tuple[str, str | None, dict]], dict]:
    """A Codex rollout file (~/.codex/sessions/..jsonl) -> events. Used for CLI threads whose history is
    paginated, which thread/read can't return with turns. Reasoning is not stored."""
    events: list[tuple[str, str | None, dict]] = []
    first = last_text = model = None
    usage = None
    calls: dict[str, tuple[str, dict]] = {}
    for line in lines:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        kind, p = o.get("type"), o.get("payload") or {}
        if kind == "turn_context":
            model = p.get("model") or model
        elif kind == "event_msg" and p.get("type") == "item_completed":
            it = p.get("item") or {}
            if it.get("type") == "UserMessage" and _text(it.get("content")).strip():
                first = first or _text(it["content"])
                events.append(("prompt.received", None, {"prompt": _text(it["content"]), "item_id": it.get("id")}))
            elif it.get("type") == "AgentMessage" and _text(it.get("content")).strip():
                last_text = _text(it["content"])
                events.append(("message.completed", None, {"text": last_text, "item_id": it.get("id"), "phase": it.get("phase")}))
            elif it.get("type") == "FileChange":
                for path, ch in (it.get("changes") or {}).items():
                    events.append(("file.changed", None, {"item_id": it.get("id"), "path": path,
                                                          "kind": (ch or {}).get("type"), "status": it.get("status")}))
        elif kind == "event_msg" and p.get("type") == "token_count":
            total = ((p.get("info") or {}).get("total_token_usage")) or {}
            if total:
                usage = {"input_tokens": total.get("input_tokens"), "output_tokens": total.get("output_tokens")}
        elif kind == "response_item" and p.get("type") == "function_call":
            try:
                args = json.loads(p.get("arguments") or "{}")
            except ValueError:
                args = {"raw": p.get("arguments")}
            why = last_text[:300] if last_text else None
            if p.get("name") in SHELL_TOOLS:
                cmd = args.get("command") or args.get("cmd")
                cmd = " ".join(cmd) if isinstance(cmd, list) else cmd
                calls[p.get("call_id")] = ("command", {"command": cmd})
                events.append(("command.started", why, {"item_id": p.get("call_id"), "command": cmd, "cwd": args.get("workdir")}))
            else:
                calls[p.get("call_id")] = ("tool", {"tool": p.get("name")})
                events.append(("tool.started", why, {"item_id": p.get("call_id"), "tool": p.get("name"), "input": args}))
        elif kind == "response_item" and p.get("type") == "function_call_output" and p.get("call_id") in calls:
            what, base = calls.pop(p["call_id"])
            out = p.get("output") if isinstance(p.get("output"), str) else json.dumps(p.get("output"))
            code = re.match(r"Exit code: (-?\d+)", out or "")
            if what == "command":
                events.append(("command.completed", None, {"item_id": p["call_id"], **base, "output": out,
                                                           "exit_code": int(code.group(1)) if code else None}))
            else:
                events.append(("tool.completed", None, {"item_id": p["call_id"], **base, "output": out}))
    return events, {"first_prompt": first, "final_response": last_text, "model": model, "usage": usage}


def _under(path: str | None, root) -> bool:
    try:
        return bool(path) and Path(path).resolve().is_relative_to(Path(root).resolve())
    except (OSError, ValueError):
        return False


class CodexSync:
    """One long-lived app-server connection, reopened if it drops."""

    def __init__(self):
        self.conn: JsonRpcConnection | None = None

    async def _ready(self) -> JsonRpcConnection:
        if self.conn and self.conn.proc and self.conn.proc.returncode is None:
            return self.conn
        await self.close()
        conn = JsonRpcConnection(codex_argv())
        await conn.start()
        await conn.request("initialize", {"clientInfo": CLIENT_INFO}, timeout=20)
        await conn.notify("initialized")
        self.conn = conn
        return conn

    async def close(self):
        if self.conn:
            await self.conn.close()
            self.conn = None

    async def sync(self, skip: set[str]) -> list[dict]:
        conn = await self._ready()
        listing = await conn.request("thread/list", {"sourceKinds": CODEX_SOURCES, "limit": settings.LIVE_SYNC_LIMIT}, timeout=30) or {}
        while not conn.notifications.empty():  # nobody else reads this connection's notifications
            conn.notifications.get_nowait()
        changes = []
        for t in listing.get("data") or []:
            tid = t.get("id")
            if not tid or tid in skip or t.get("ephemeral") or _under(t.get("cwd"), settings.AGENT_WORKSPACE_ROOT):
                continue
            key = f"sync:codex:{tid}"
            updated_s = float(t.get("updatedAt") or 0) or None
            inv = await _existing(key)
            if await _unchanged(inv, updated_s):
                continue
            if t.get("historyMode") == "paginated" and t.get("path"):
                # CLI threads: thread/read can't return paginated history, so read the rollout file
                lines = await asyncio.to_thread(Path(t["path"]).read_text, encoding="utf-8", errors="replace")
                events, summary = normalize_rollout(lines.splitlines())
            else:
                full = (await conn.request("thread/read", {"threadId": tid, "includeTurns": True}, timeout=30) or {}).get("thread") or {}
                events, summary = normalize_codex(full)
            change = await _upsert(
                key=key, run_id=f"codex-thread-{tid[:8]}", agent_id="codex-app", provider="codex", runtime=CODEX_RUNTIME,
                model=summary.get("model"), first_prompt=summary["first_prompt"] or t.get("preview"), final=summary["final_response"],
                events=events, thread_id=tid, updated_s=updated_s, usage=summary.get("usage"),
                meta={"title": t.get("name") or (t.get("preview") or "")[:120], "cwd": t.get("cwd"), "app": "codex",
                      "source": t.get("source")})
            if change:
                changes.append(change)
        return changes


# ---------- Antigravity ----------

def agy_dir() -> Path:
    return Path(settings.ANTIGRAVITY_DIR) if settings.ANTIGRAVITY_DIR else Path.home() / ".gemini" / "antigravity"


def uri_path(uri: str) -> str:
    """file:///c%3A/Users/x/proj -> c:/Users/x/proj as a native path."""
    p = urllib.parse.unquote(urllib.parse.urlparse(uri).path)
    if re.match(r"^/[A-Za-z]:", p):
        p = p[1:]
    return str(Path(p))


def _split(body: str, offsets_blob) -> list[tuple[int, str]]:
    """A chunk's text body plus [[step, byte_offset], ...] -> [(step, text)]."""
    try:
        offsets = json.loads(offsets_blob or b"[]")
    except ValueError:
        return []
    raw = (body or "").encode("utf-8")
    out = []
    for n, (step, start) in enumerate(offsets):
        end = offsets[n + 1][1] if n + 1 < len(offsets) else len(raw)
        text = raw[start:end].decode("utf-8", errors="replace").strip()
        if text:
            out.append((int(step), text))
    return out


def _agy_index():
    db_path = agy_dir() / "conversation_summaries.db"
    return sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True, timeout=5) if db_path.is_file() else None


# chats of the signed-in account belong to one of its projects; an earlier account's chats have none
_THIS_ACCOUNT = "AND project_id != ''"


def read_antigravity(limit: int) -> list[dict]:
    """Newest top-level chats from Antigravity's own index, opened read-only."""
    conn = _agy_index()
    if conn is None:
        return []
    mine = _THIS_ACCOUNT if settings.ANTIGRAVITY_PROJECT_CHATS_ONLY else ""
    with contextlib.closing(conn) as c:
        rows = c.execute(
            "SELECT conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status "
            f"FROM conversation_summaries WHERE nesting_depth = 0 {mine} ORDER BY last_modified_time DESC LIMIT ?",
            (limit,)).fetchall()
        out = []
        for cid, title, preview, steps, modified, uris, status in rows:
            try:
                folders = [uri_path(u) for u in json.loads(uris or "[]")]
            except ValueError:
                folders = []
            chunks = c.execute("SELECT c8, c9, c13, c14 FROM conversations_fts_content WHERE c0 = ? "
                               "ORDER BY CAST(c1 AS INTEGER)", (cid,)).fetchall()
            out.append({"id": cid, "title": title or preview, "steps": steps, "modified": modified,
                        "folders": folders, "status": status, "chunks": chunks})
        return out


def normalize_antigravity(chunks, running: bool = False) -> tuple[list[tuple[str, str | None, dict]], dict]:
    """The index keeps the text of every user and agent step (tool steps aren't in it). While the chat
    runs, its last agent step may still be growing, so it waits for a later pass."""
    steps: list[tuple[int, int, str]] = []
    for user_offsets, agent_offsets, user_body, agent_body in chunks:
        steps += [(s, 0, t) for s, t in _split(user_body, user_offsets)]
        steps += [(s, 1, t) for s, t in _split(agent_body, agent_offsets)]
    steps.sort()
    if running and steps and steps[-1][1] == 1:
        steps = steps[:-1]
    events: list[tuple[str, str | None, dict]] = []
    first = last = None
    for step, who, text in steps:
        if who == 0:
            first = first or text
            events.append(("prompt.received", None, {"prompt": text, "step": step}))
        else:
            last = text
            events.append(("message.completed", None, {"text": text, "step": step}))
    return events, {"first_prompt": first, "final_response": last}


def other_account_chats() -> set[str]:
    """Ids of Antigravity chats that aren't the signed-in account's (see ANTIGRAVITY_PROJECT_CHATS_ONLY)."""
    conn = _agy_index() if settings.ANTIGRAVITY_PROJECT_CHATS_ONLY else None
    if conn is None:
        return set()
    with contextlib.closing(conn) as c:
        return {r[0] for r in c.execute(f"SELECT conversation_id FROM conversation_summaries WHERE NOT (1 = 1 {_THIS_ACCOUNT})")}


async def forget_other_account_chats() -> int:
    """Remove the tower's copies of chats synced before they were recognised as another account's.
    Only the tower's own rows go; Antigravity's files are never touched."""
    ids = await asyncio.to_thread(other_account_chats)
    if not ids:
        return 0
    rows = await db.pool.fetch(
        "DELETE FROM agent_invocations WHERE runtime = $1 AND provider_thread_id = ANY($2::text[]) RETURNING run_id",
        AGY_RUNTIME, list(ids))                    # their steps go with them (ON DELETE CASCADE)
    runs = list({r["run_id"] for r in rows})
    if runs:
        await db.pool.execute("DELETE FROM agent_sessions WHERE run_id = ANY($1::text[]) AND provider = 'antigravity' "
                              "AND NOT EXISTS (SELECT 1 FROM agent_invocations i WHERE i.session_id = agent_sessions.session_id)", runs)
        await db.pool.execute(
            """DELETE FROM runs r WHERE r.run_id = ANY($1::text[])
                 AND NOT EXISTS (SELECT 1 FROM agent_invocations i WHERE i.run_id = r.run_id)
                 AND NOT EXISTS (SELECT 1 FROM agent_sessions s WHERE s.run_id = r.run_id)
                 AND NOT EXISTS (SELECT 1 FROM events e WHERE e.run_id = r.run_id)
                 AND NOT EXISTS (SELECT 1 FROM issues x WHERE x.run_id = r.run_id)
                 AND NOT EXISTS (SELECT 1 FROM digests d WHERE d.run_id = r.run_id)""", runs)
        log.info("removed %d synced Antigravity chat(s) from another account", len(rows))
    return len(rows)


async def sync_antigravity(skip: set[str]) -> list[dict]:
    changes = []
    for conv in await asyncio.to_thread(read_antigravity, settings.LIVE_SYNC_LIMIT):
        cwd = conv["folders"][0] if conv["folders"] else None
        if conv["id"] in skip or _under(cwd, settings.AGENT_WORKSPACE_ROOT):
            continue
        try:
            updated_s = dt.datetime.fromisoformat(str(conv["modified"])).timestamp()
        except ValueError:
            updated_s = None
        running = conv["status"] not in ("", "CASCADE_RUN_STATUS_IDLE")
        key = f"sync:antigravity:{conv['id']}"
        inv = await _existing(key)
        if inv and (inv.get("metadata") or {}).get("updated_s") == updated_s and (inv["status"] == "running") == running:
            continue
        events, summary = normalize_antigravity(conv["chunks"], running)
        change = await _upsert(
            key=key, run_id=f"antigravity-{conv['id'][:8]}", agent_id="antigravity-app", provider="antigravity",
            runtime=AGY_RUNTIME, model=None, first_prompt=summary["first_prompt"] or conv["title"],
            final=summary["final_response"], events=events, thread_id=conv["id"], updated_s=updated_s, usage=None,
            meta={"title": conv["title"], "cwd": cwd, "folders": conv["folders"], "app": "antigravity",
                  "steps": conv["steps"]}, active=running)
        if change:
            changes.append(change)
    return changes


# ---------- loop ----------

_codex = CodexSync()


async def sync_once() -> list[dict]:
    skip = await _tower_thread_ids()
    changes: list[dict] = []
    for name, fn in (("claude", lambda: sync_claude(skip)), ("codex", lambda: _codex.sync(skip)),
                     ("antigravity", lambda: sync_antigravity(skip))):
        try:
            changes += await fn()
        except (ImportError, OSError, RuntimeError_, asyncio.TimeoutError, sqlite3.Error) as exc:
            log.debug("%s sync skipped: %r", name, exc)
        except Exception:
            log.exception("%s sync failed", name)
    for c in changes:
        await stream.publish("sync.updated", c)
    return changes


async def run_forever() -> None:
    try:
        await forget_other_account_chats()
    except Exception:
        log.exception("couldn't remove other accounts' synced chats")
    while True:
        try:
            await sync_once()
        except Exception:
            log.exception("live sync pass failed")
        await asyncio.sleep(settings.LIVE_SYNC_INTERVAL_S)


async def live_sessions(limit: int = 30) -> list[dict]:
    rows = await db.pool.fetch(
        """SELECT invocation_id, run_id, agent_id, provider, runtime, status, model, last_sequence, created_at,
                  completed_at, metadata->>'title' AS title, metadata->>'cwd' AS cwd, metadata->>'app' AS app
           FROM agent_invocations WHERE runtime IN ('claude_code_import', 'codex_app_import', 'antigravity_app_import')
           ORDER BY COALESCE(completed_at, created_at) DESC LIMIT $1""",
        limit,
    )
    return [db._out(r) for r in rows]


def start() -> asyncio.Task | None:
    return asyncio.create_task(run_forever()) if settings.LIVE_SYNC_ENABLED else None


async def shutdown(task: asyncio.Task | None) -> None:
    if task:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    await _codex.close()
