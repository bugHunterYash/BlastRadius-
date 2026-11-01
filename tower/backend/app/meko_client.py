"""The shared notebook: the Meko Datapack over MCP, or a local table when Meko isn't configured.

Everything that touches agent memory from the backend goes through write() and
search(), so switching from the local stand-in to real Meko is one env var.
Tool names and argument names come from config (verify with list_meko_tools()).
"""

import json
import uuid
from contextlib import asynccontextmanager

from app import db
from app.config import settings


@asynccontextmanager
async def meko():
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.shared._httpx_utils import create_mcp_http_client

    # Meko: a user API key from Settings > API Keys, sent as a bearer token
    client = create_mcp_http_client(headers={"Authorization": f"Bearer {settings.MEKO_API_KEY}"})
    async with client, streamable_http_client(settings.MEKO_MCP_URL, http_client=client) as streams:
        async with ClientSession(streams[0], streams[1]) as session:
            await session.initialize()
            yield session


async def list_meko_tools() -> list[str]:
    async with meko() as s:
        return [t.name for t in (await s.list_tools()).tools]


async def call(tool: str, args: dict):
    async with meko() as s:
        return await s.call_tool(tool, args)


def _texts(result) -> list[str]:
    return [c.text for c in getattr(result, "content", []) if getattr(c, "text", None)]


def _json(result):
    """A tool's JSON answer; Meko reports failures as {"error": ..., "detail": ...}."""
    texts = _texts(result)
    if getattr(result, "is_error", False) or getattr(result, "isError", False):
        raise RuntimeError(f"meko: {(texts[0] if texts else 'tool error')[:300]}")
    try:
        data = json.loads(texts[0]) if texts else {}
    except ValueError:
        return {"text": texts[0]}
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"meko {data['error']}: {data.get('detail', '')}")
    return data


def _meta(m: dict) -> dict:
    meta = m.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            meta = {}
    return meta if isinstance(meta, dict) else {}


_ctx: dict[str, str] = {}

# The Meko switch in the UI. Off: agents work alone (no shared memory at all) and notes stay in the local
# table. Kept in app_state, so it survives a restart. On by default.
_sharing = True


async def load_switch() -> None:
    global _sharing
    _sharing = (await db.pool.fetchval("SELECT value FROM app_state WHERE key = 'meko_sharing'")) != "off"


async def set_sharing(on: bool) -> None:
    global _sharing
    await db.pool.execute(
        "INSERT INTO app_state (key, value) VALUES ('meko_sharing', $1) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = clock_timestamp()", "on" if on else "off")
    _sharing = on


def sharing() -> bool:
    """Agents share memory (the switch is on)."""
    return _sharing


def mode() -> str:
    """Where shared memory goes now: "meko", "local" (no MEKO_MCP_URL), or "off" (the switch is off)."""
    if not _sharing:
        return "off"
    return settings.notebook_mode


async def _context(s) -> dict:
    """The tower's own Meko conversation and datapack; Meko's tools need both. The conversation id is kept
    in Postgres, so a restart reuses it instead of opening a new one."""
    if not _ctx:
        agent = settings.MEKO_AGENT_ID
        conv = await db.pool.fetchval("SELECT value FROM app_state WHERE key = 'meko_conversation_id'")
        pack = settings.MEKO_DATAPACK_ID
        if not conv:
            conv = _json(await s.call_tool("conversation_create", {"agent_id": agent, "title": "Agent Control Tower"}))["id"]
            await db.pool.execute(
                "INSERT INTO app_state (key, value) VALUES ('meko_conversation_id', $1) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = clock_timestamp()", conv)
        if not pack:
            packs = _json(await s.call_tool("datapack_list", {"conversation_id": conv, "limit": 50}))
            packs = packs if isinstance(packs, list) else packs.get("datapacks") or []
            named = [d for d in packs if d.get("datapack_name") == settings.MEKO_DATAPACK]
            pack = (named or packs or [{}])[0].get("datapack_id", "")
        _ctx.update(conversation_id=conv, datapack_id=pack)
    return {"conversation_id": _ctx["conversation_id"], "agent_id": settings.MEKO_AGENT_ID,
            **({"datapack_id": _ctx["datapack_id"]} if _ctx.get("datapack_id") else {})}


async def meko_info() -> dict:
    """The conversation and datapack the tower uses (ids only)."""
    async with meko() as s:
        ctx = await _context(s)
    return {"conversation_id": ctx["conversation_id"], "datapack_id": ctx.get("datapack_id")}


async def write(text: str, kind: str = "memory", datapack: str | None = None) -> str:
    """Store one notebook item and return a reference to it."""
    if mode() == "meko":
        async with meko() as s:
            ctx = await _context(s)
            data = _json(await s.call_tool(settings.MEKO_TOOL_WRITE, {
                settings.MEKO_TEXT_ARG: text, **ctx, "metadata": json.dumps({"kind": kind, "source": "control-tower"})}))
        ref = data.get("id") or data.get("memory_id") or (data.get("results") or [{}])[0].get("id") if isinstance(data, dict) else None
        return f"meko:{ref or 'ok'}"
    item_id = uuid.uuid4()
    await db.notebook_write(item_id, datapack or settings.MEKO_DATAPACK, kind, text)
    return f"local:{item_id}"


async def read(ref: str) -> str | None:
    """The text of one item written by write(), by the reference it returned. None if it can't be read."""
    kind, _, item_id = ref.partition(":")
    if kind == "meko" and settings.notebook_mode == "meko" and item_id and item_id != "ok":   # read old items even when off
        async with meko() as s:
            data = _json(await s.call_tool("memory_get_by_id", {"memory_id": item_id, **await _context(s)}))
        return (data.get("memory") or data.get("text")) if isinstance(data, dict) else None
    if kind == "local":
        return await db.pool.fetchval("SELECT text FROM notebook_items WHERE item_id = $1", uuid.UUID(item_id))
    return None


async def search(query: str | None, limit: int = 50, datapack: str | None = None) -> list[dict]:
    """Newest-first notebook items whose text contains query (all items when query is empty)."""
    if mode() == "meko":
        async with meko() as s:
            ctx = await _context(s)
            if query:
                data = _json(await s.call_tool(settings.MEKO_TOOL_SEARCH, {settings.MEKO_QUERY_ARG: query, "limit": limit, **ctx}))
            else:
                data = _json(await s.call_tool("memory_get_all", ctx))
        rows = data if isinstance(data, list) else data.get("results") or data.get("memories") or []
        return [{"item_id": m.get("id"), "kind": _meta(m).get("kind", "memory"),
                 "text": m.get("memory") or m.get("text") or "", "created_at": m.get("created_at")}
                for m in rows if isinstance(m, dict)][:limit]
    return await db.notebook_search(datapack or settings.MEKO_DATAPACK, query, limit)


async def record_approval(fix: dict, approval: dict) -> str:
    text = (
        f"[approval fix:{fix['fix_id']}] {approval['decision']} by {approval['decided_by']}"
        f" | {fix['fix_type']} on {fix['target_agent']}"
        f" | before: {fix['before']!r} | after: {fix['after']!r}"
        + (f" | note: {approval['note']}" if approval.get("note") else "")
    )
    return await write(text, kind="approval")
