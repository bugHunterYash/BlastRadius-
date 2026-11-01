"""Agent-side SDK: every memory call does the real notebook read or write, then sends one tagged event.

Agents call remember, recall and handoff instead of Meko tools directly. The version tag stored
inside each item ("[fact:price v2] ...") is what makes stale reads detectable.

Notebook backends:
  * Meko over MCP when init(meko_url=...) is given (tool names are "verify" until we have access)
  * otherwise the backend's local notebook (/v1/notebook), a stand-in for the Datapack
"""

import asyncio
import contextvars
import datetime as dt
import os
import re
import uuid
from contextlib import contextmanager

import httpx

_run = contextvars.ContextVar("run_id")
_agent = contextvars.ContextVar("agent", default="system")
# Set when memory calls happen inside an agent invocation, so the tower can join the two.
# Runtimes launched by the tower export TOWER_INVOCATION_ID to the agent process.
_invocation = contextvars.ContextVar("invocation_id", default=None)
_client: httpx.Client | None = None
_cfg: dict = {}

TAG = re.compile(r"\[fact:(?P<key>[^\s\]]+) v(?P<version>\d+)\]\s?")


class MemoryNotFound(LookupError):
    pass


def init(api_url: str = "http://localhost:8000", token: str | None = None, datapack: str = "content-team",
         meko_url: str | None = None, meko_key: str | None = None) -> None:
    global _client
    token = token or os.environ.get("TOWER_INGEST_TOKEN", "dev-ingest-token-change-me")
    _client = httpx.Client(base_url=api_url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    _cfg.update(
        datapack=datapack,
        meko_url=meko_url or os.environ.get("MEKO_MCP_URL") or None,
        meko_key=meko_key or os.environ.get("MEKO_API_KEY", ""),
        meko_write=os.environ.get("MEKO_TOOL_WRITE", "memory_add"),      # verify
        meko_search=os.environ.get("MEKO_TOOL_SEARCH", "memory_search"),  # verify
        meko_text_arg=os.environ.get("MEKO_TEXT_ARG", "content"),
        meko_query_arg=os.environ.get("MEKO_QUERY_ARG", "query"),
    )


def _http() -> httpx.Client:
    if _client is None:
        raise RuntimeError("call tower.init() first")
    return _client


def _emit(op: str, **fields) -> dict:
    event = {"event_id": str(uuid.uuid4()), "run_id": _run.get(), "agent": _agent.get(),
             "op": op, "ts": dt.datetime.now(dt.timezone.utc).isoformat(), **fields}
    invocation = _invocation.get() or os.environ.get("TOWER_INVOCATION_ID")
    if invocation:
        event["invocation_id"] = invocation
    r = _http().post("/v1/events", json=event)
    r.raise_for_status()
    return r.json()


# ---------- notebook backends ----------

async def _meko_call(tool: str, args: dict) -> list[str]:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    headers = {"Authorization": f"Bearer {_cfg['meko_key']}"}  # verify auth scheme
    async with streamablehttp_client(_cfg["meko_url"], headers=headers) as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            result = await s.call_tool(tool, args)
    return [c.text for c in result.content if getattr(c, "text", None)]


def _notebook_write(text: str) -> None:
    if _cfg.get("meko_url"):
        asyncio.run(_meko_call(_cfg["meko_write"], {_cfg["meko_text_arg"]: text}))
        return
    _http().post("/v1/notebook", json={"text": text, "datapack": _cfg["datapack"]}).raise_for_status()


def _notebook_search(query: str) -> list[str]:
    if _cfg.get("meko_url"):
        return asyncio.run(_meko_call(_cfg["meko_search"], {_cfg["meko_query_arg"]: query}))
    r = _http().get("/v1/notebook", params={"q": query, "datapack": _cfg["datapack"], "limit": 200})
    r.raise_for_status()
    return [item["text"] for item in r.json()]


# ---------- public API ----------

@contextmanager
def run(run_id: str | None = None, scenario: str | None = None):
    """Group everything inside into one run. run_end triggers analysis on the backend."""
    rid = run_id or f"run-{uuid.uuid4().hex[:8]}"
    tok, atok = _run.set(rid), _agent.set("system")
    _emit("run_start", datapack=_cfg["datapack"], scenario=scenario)
    try:
        yield rid
    finally:
        _emit("run_end")
        _agent.reset(atok)
        _run.reset(tok)


@contextmanager
def as_agent(name: str, invocation_id: str | None = None):
    """Act as one agent. Pass the invocation_id the tower returned from /v1/agents/{id}/invoke to tie
    these memory calls to that Claude/Codex execution."""
    tok, itok = _agent.set(name), _invocation.set(invocation_id)
    try:
        yield
    finally:
        _invocation.reset(itok)
        _agent.reset(tok)


def remember(key: str, value: str, why: str | None = None) -> int:
    """Write a fact. The backend assigns the version atomically; the tag goes into the notebook item.
    `why` is the agent's own one-line reason; the Summarizer uses it to explain the run."""
    version = _emit("write", fact_key=key, value_preview=value[:200], reason=why)["version"]
    _notebook_write(f"[fact:{key} v{version}] {value}")
    return version


def recall_versioned(key: str, version: int | None = None, why: str | None = None) -> tuple[str, int]:
    """Read a fact and record which version this agent actually got.

    version=None returns the newest item. Passing a version returns that exact one, which is how an
    agent re-reads from its own earlier notes (and how scenarios reproduce stale reads).
    """
    items = []
    for text in _notebook_search(f"[fact:{key} v{version}]" if version else f"[fact:{key} v"):
        m = TAG.match(text)
        if m and m["key"] == key:
            items.append((int(m["version"]), text[m.end():]))
    if version is not None:
        items = [i for i in items if i[0] == version]
    if not items:
        raise MemoryNotFound(f"no {key!r}" + (f" v{version}" if version else "") + " in the notebook")
    got_version, value = max(items)
    _emit("read", fact_key=key, version=got_version, reason=why)
    return value, got_version


def recall(key: str, version: int | None = None, why: str | None = None) -> str:
    return recall_versioned(key, version, why)[0]


def handoff(to: str, why: str | None = None) -> None:
    _emit("handoff", target_agent=to, reason=why)
