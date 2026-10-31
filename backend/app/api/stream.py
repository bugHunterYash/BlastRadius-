# =============================================================================
# backend.app.api.stream — SSE live feed (F2)
# =============================================================================
# Framing rules (shared with tests via AppState.sse_data): one `event:` line,
# one `data:` line (JSON), blank line terminator. Heartbeat as an SSE comment
# every ~15s: proxies and load balancers kill idle connections; a comment is
# invisible to EventSource clients but keeps the pipe warm.
#
# Why SSE over WebSockets (spec): the flow is server→client only (buckets,
# state, evidence). Client commands are ordinary POSTs (start/abort), so a
# bidirectional socket buys nothing but reconnect complexity. EventSource
# reconnects natively; on reconnect the UI falls back to GET /samples?from=
# to backfill what it missed — buckets live in the store, the stream is a
# convenience, never the source of truth.
#
# Disconnect: the async generator's finally unsubscribes — a closed tab must
# not leak queues (tested via subscriber_count).
# =============================================================================

from __future__ import annotations

import asyncio
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from core.store import NotFound

router = APIRouter(prefix="/api/experiments", tags=["stream"])

HEARTBEAT_S = 15.0


@router.get("/{experiment_id}/stream")
async def stream(experiment_id: UUID, request: Request):
    store = request.app.state.br.store
    try:
        store.get_experiment(experiment_id)
    except NotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    br_state = request.app.state.br
    queue = br_state.broadcaster.subscribe()

    async def event_source():
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_S)
                except asyncio.TimeoutError:
                    # SSE comment line — invisible to EventSource, keeps
                    # proxies from reaping the idle connection.
                    yield b": heartbeat\n\n"
                    continue
                # Single framer: AppState.sse_data (tests use the same bytes).
                yield br_state.sse_data(message["event"], message["data"])
        finally:
            br_state.broadcaster.unsubscribe(queue)

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # disables nginx-style proxy buffering that would delay events
            "X-Accel-Buffering": "no",
        },
    )
