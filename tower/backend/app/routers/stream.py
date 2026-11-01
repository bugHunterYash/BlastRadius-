import json

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.stream import subscribe

router = APIRouter(tags=["stream"])


def matches(data: str, filters: dict[str, str]) -> bool:
    """True if a published payload passes the run/agent/invocation filters."""
    if not filters:
        return True
    try:
        d = json.loads(data)
    except ValueError:
        return False
    if not isinstance(d, dict):
        return False
    if "agent_id" not in d and "agent" in d:   # memory events and issues name the agent "agent"
        d = {**d, "agent_id": d["agent"]}
    return all(str(d.get(k)) == v for k, v in filters.items())


@router.get("/v1/stream")
async def stream(request: Request, run_id: str | None = None, agent_id: str | None = None,
                 invocation_id: str | None = None, exclude: str | None = None):
    """One live stream for everything. Optional filters by run, agent and invocation. Agent execution
    events carry id "<invocation_id>:<sequence>"; after a reconnect, fetch what was missed from
    /v1/invocations/{id}/events?after_sequence=N.
    `exclude` drops event names (comma list), e.g. agent.message.delta,agent.command.output: a dashboard
    that doesn't need token-by-token text skips the bulk of the traffic."""
    filters = {k: v for k, v in (("run_id", run_id), ("agent_id", agent_id), ("invocation_id", invocation_id)) if v}
    skip = {n.strip() for n in (exclude or "").split(",") if n.strip()}

    async def gen():
        # Send something right away: proxies (Vite's included) hold the response headers until
        # the first bytes arrive, which would leave the browser "connecting" until the first ping.
        yield {"event": "ready", "data": json.dumps({"filters": filters})}
        async for name, data in subscribe():
            if await request.is_disconnected():
                break
            if name in skip or not matches(data, filters):
                continue
            msg = {"event": name, "data": data}
            if name.startswith("agent."):
                d = json.loads(data)
                msg["id"] = f"{d.get('invocation_id')}:{d.get('sequence')}"
            yield msg

    return EventSourceResponse(gen(), ping=15)
