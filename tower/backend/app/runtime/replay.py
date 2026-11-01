"""Replays a recorded transcript instead of calling a provider, for demos without credentials.

Off unless REPLAY_RUNTIME_ENABLED=true, and every invocation it handles is stored with
provider="replay" and runtime="replay", so a replay can never be mistaken for a live run.
Transcript: REPLAY_DIR/<agent_id>.jsonl, one {"event_type", "why", "payload"} per line, and a
last line {"result": {...RuntimeResult fields}}. "{prompt}" in any string is replaced by the prompt.
"""

import asyncio
import json

from app.config import settings
from app.runtime.base import AgentRuntime, EventSink, RuntimeError_
from app.runtime.models import ProviderHealth, RuntimeEvent, RuntimeRequest, RuntimeResult


def _fill(value, prompt: str):
    if isinstance(value, str):
        return value.replace("{prompt}", prompt)
    if isinstance(value, dict):
        return {k: _fill(v, prompt) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill(v, prompt) for v in value]
    return value


class ReplayRuntime(AgentRuntime):
    name = "replay"
    provider = "replay"

    def __init__(self):
        self._cancelled: set[str] = set()

    async def invoke(self, request: RuntimeRequest, emit: EventSink) -> RuntimeResult:
        path = settings.REPLAY_DIR / f"{request.agent_id}.jsonl"
        if not settings.REPLAY_RUNTIME_ENABLED:
            raise RuntimeError_("replay runtime is disabled")
        if not path.exists():
            raise RuntimeError_(f"no transcript at {path}")
        result = {"status": "completed"}
        for line in path.read_text(encoding="utf-8").splitlines():
            if str(request.invocation_id) in self._cancelled:
                return RuntimeResult(status="cancelled", error_message="cancelled during replay")
            if not line.strip():
                continue
            rec = _fill(json.loads(line), request.prompt)
            if "result" in rec:
                result = rec["result"]
                continue
            await emit(RuntimeEvent(event_type=rec["event_type"], why=rec.get("why"), payload=rec.get("payload", {})))
            await asyncio.sleep(0.01)
        return RuntimeResult(**{**result, "provider_session_id": f"replay-{request.invocation_id}"})

    async def cancel(self, invocation_id: str) -> bool:
        self._cancelled.add(invocation_id)
        return True

    async def health(self) -> ProviderHealth:
        n = len(list(settings.REPLAY_DIR.glob("*.jsonl"))) if settings.REPLAY_DIR.exists() else 0
        return ProviderHealth(provider="replay", enabled=settings.REPLAY_RUNTIME_ENABLED,
                              available=settings.REPLAY_RUNTIME_ENABLED and n > 0,
                              detail=f"{n} recorded transcripts; not a live provider")
