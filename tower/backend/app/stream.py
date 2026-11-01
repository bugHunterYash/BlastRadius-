"""In-process SSE broadcaster. One process only; move to Redis pub/sub to scale out."""

import asyncio
import json
from collections.abc import AsyncIterator

_subscribers: set[asyncio.Queue] = set()


def _encode(data) -> str:
    return json.dumps(data, default=str)


async def publish(name: str, data) -> None:
    payload = _encode(data)
    for q in list(_subscribers):
        try:
            q.put_nowait((name, payload))
        except asyncio.QueueFull:  # a stuck client must not block everyone else
            pass


async def subscribe() -> AsyncIterator[tuple[str, str]]:
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    _subscribers.add(q)
    try:
        while True:
            yield await q.get()
    finally:
        _subscribers.discard(q)
