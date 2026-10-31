"""The shared notebook: the Meko Datapack over MCP, or a local table when Meko isn't configured.

Everything that touches agent memory from the backend goes through write() and
search(), so switching from the local stand-in to real Meko is one env var.
Tool names and argument names come from config (verify with list_meko_tools()).
"""

import uuid
from contextlib import asynccontextmanager

from app import db
from app.config import settings


@asynccontextmanager
async def meko():
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    headers = {"Authorization": f"Bearer {settings.MEKO_API_KEY}"}  # verify auth scheme
    async with streamablehttp_client(settings.MEKO_MCP_URL, headers=headers) as (r, w, _):
        async with ClientSession(r, w) as session:
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


async def write(text: str, kind: str = "memory", datapack: str | None = None) -> str:
    """Store one notebook item and return a reference to it."""
    if settings.notebook_mode == "meko":
        result = await call(settings.MEKO_TOOL_WRITE, {settings.MEKO_TEXT_ARG: text})
        texts = _texts(result)
        return f"meko:{texts[0][:120]}" if texts else "meko:ok"
    item_id = uuid.uuid4()
    await db.notebook_write(item_id, datapack or settings.MEKO_DATAPACK, kind, text)
    return f"local:{item_id}"


async def search(query: str | None, limit: int = 50, datapack: str | None = None) -> list[dict]:
    """Newest-first notebook items whose text contains query (all items when query is empty)."""
    if settings.notebook_mode == "meko":
        result = await call(settings.MEKO_TOOL_SEARCH, {settings.MEKO_QUERY_ARG: query or ""})
        return [{"item_id": None, "kind": "memory", "text": t, "created_at": None} for t in _texts(result)][:limit]
    return await db.notebook_search(datapack or settings.MEKO_DATAPACK, query, limit)


async def record_approval(fix: dict, approval: dict) -> str:
    text = (
        f"[approval fix:{fix['fix_id']}] {approval['decision']} by {approval['decided_by']}"
        f" | {fix['fix_type']} on {fix['target_agent']}"
        f" | before: {fix['before']!r} | after: {fix['after']!r}"
        + (f" | note: {approval['note']}" if approval.get("note") else "")
    )
    return await write(text, kind="approval")
