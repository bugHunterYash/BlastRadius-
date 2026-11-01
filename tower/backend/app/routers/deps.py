import hmac
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request

from app.config import settings


def require_ingest_token(authorization: str = Header(default="")) -> None:
    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token.encode(), settings.TOWER_INGEST_TOKEN.encode()):
        raise HTTPException(401, "bad or missing ingest token")


_asks: dict[str, deque] = defaultdict(deque)


def ask_rate_limit(request: Request) -> None:
    """At most ASK_PER_MINUTE timeline questions per client per minute, to cap LLM cost."""
    now, key = time.monotonic(), request.client.host if request.client else "?"
    hits = _asks[key]
    while hits and now - hits[0] > 60:
        hits.popleft()
    if len(hits) >= settings.ASK_PER_MINUTE:
        raise HTTPException(429, "too many questions, try again in a minute")
    hits.append(now)
