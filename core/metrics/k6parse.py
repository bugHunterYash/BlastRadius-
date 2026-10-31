# =============================================================================
# core.metrics.k6parse — k6 `--out json` stream → RawSample events (C3 part 1)
# =============================================================================
# k6 emits one JSON object per line. Two of its metrics carry per-REQUEST
# data as separate Points that must be JOINED to reconstruct one request:
#   http_req_duration  { time, value: <ms>, tags: { name, status, ... } }
#   http_req_failed    { time, value: 0|1, tags: { name, ... } }
# The join key is (time, tags.name): k6 stamps both Points with the same
# timestamp and request name. Failure semantics: http_req_failed is k6's own
# definition (4xx/5xx + transport errors by default) — we deliberately use
# IT instead of re-deriving from status, so our error rate matches what k6's
# own thresholds saw (same numbers the abortOnFail net acted on).
#
# WHY a joiner with a flush(): line order is not guaranteed (k6 multiplexes
# metric writers) — duration may arrive before failed or after. At stream
# end, flush() emits any duration-only leftovers as samples WITHOUT failure
# data (recorded as success-unknown → treated as non-failure, commented) —
# a truncated stream is a run-level condition the controller surfaces as
# state/partial, never silently dropped counts.
#
# Non-metric lines (summaries, {"type":"End"...}, malformed) → None: parsing
# is best-effort over a live stream; one weird line must not kill a run.
#
# TIME UNITS: k6 Point `time` is epoch MILLISECONDS. RawSample.t is ELAPSED
# SECONDS since experiment start (see RawSample docstring — phase windows
# filter on elapsed). The conversion happens exactly once, in the Joiner,
# which owns start_epoch; K6Event keeps raw k6 time for join keys.
# =============================================================================

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from core.schemas.metrics import RawSample

# Metrics we consume. Everything else (http_reqs, iterations, vus, checks...)
# is ignored — bucket math needs only these three.
_DURATION = "http_req_duration"
_FAILED = "http_req_failed"
_DROPPED = "dropped_iterations"


@dataclass(frozen=True)
class K6Event:
    """One parsed Point. kind=duration|failed carry (t, endpoint, value);
    kind=dropped carries generator-internal drops (no endpoint).
    t: raw k6 Point time in epoch MILLISECONDS (join key only — the Joiner
    converts to elapsed seconds when it builds a RawSample)."""

    kind: Literal["duration", "failed", "dropped"]
    t: float
    value: float
    endpoint: str
    status: int


def parse_line(line: str) -> K6Event | None:
    """Parse one stdout line. Returns None for anything we don't consume —
    including non-JSON noise — by design (never raise on a live stream)."""
    line = line.strip()
    if not line or not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    if obj.get("type") != "Point":
        return None
    metric = obj.get("metric")
    data = obj.get("data") or {}
    t = data.get("time")
    value = data.get("value")
    if t is None or value is None:
        return None
    tags = data.get("tags") or {}

    if metric == _DURATION:
        return K6Event(kind="duration", t=float(t), value=float(value),
                       endpoint=str(tags.get("name", "")), status=_status(tags))
    if metric == _FAILED:
        return K6Event(kind="failed", t=float(t), value=float(value),
                       endpoint=str(tags.get("name", "")), status=_status(tags))
    if metric == _DROPPED:
        return K6Event(kind="dropped", t=float(t), value=float(value),
                       endpoint="", status=0)
    return None


def _status(tags: dict) -> int:
    try:
        return int(str(tags.get("status", "0")))
    except ValueError:
        return 0


class RequestJoiner:
    """Joins duration + failed Points into RawSamples with t in elapsed
    seconds (raw k6 ms time − start_epoch).

    add() returns a RawSample when a pair completes, else None.
    flush() emits unpaired durations (stream truncated mid-request).
    lost_pairs counts pairs that never completed — the controller turns
    a nonzero count into a limitation line instead of hiding it."""

    def __init__(self, start_epoch: float) -> None:
        self.start_epoch = start_epoch
        self._pending: dict[tuple[float, str], dict] = {}
        self.lost_pairs: int = 0

    @staticmethod
    def _key(ev: K6Event) -> tuple[float, str]:
        # Round: both Points carry identical float times in practice, but a
        # serialization difference (1.0 vs 1.0000000001) must not orphan a pair.
        return (round(ev.t, 6), ev.endpoint)

    def add(self, ev: K6Event) -> RawSample | None:
        if ev.kind == "dropped":
            return None
        key = self._key(ev)
        slot = self._pending.setdefault(key, {})
        if ev.kind == "duration":
            slot["duration"] = ev
        else:
            slot["failed"] = ev
        if "duration" in slot and "failed" in slot:
            dur: K6Event = slot["duration"]
            fail: K6Event = slot["failed"]
            del self._pending[key]
            return self._to_sample(dur, failed=bool(fail.value), start_epoch=self.start_epoch)
        return None

    @staticmethod
    def _to_sample(dur: K6Event, *, failed: bool, start_epoch: float) -> RawSample:
        error = ""
        if failed:
            error = f"HTTP {dur.status}" if dur.status >= 400 else "request failed"
        return RawSample(
            t=(dur.t / 1000.0) - start_epoch,   # epoch ms → elapsed seconds
            duration_ms=dur.value,
            endpoint=dur.endpoint,
            status=dur.status,
            error=error,
        )

    def flush(self) -> list[RawSample]:
        """Truncated stream: emit what we have (duration known, failure
        unknown). Counted, not hidden — controller reports lost_pairs."""
        out: list[RawSample] = []
        for key, slot in list(self._pending.items()):
            if "duration" in slot:
                self.lost_pairs += 1
                out.append(self._to_sample(slot["duration"], failed=False, start_epoch=self.start_epoch))
            del self._pending[key]
        return out
