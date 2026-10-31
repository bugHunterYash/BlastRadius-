# =============================================================================
# backend.app.state — application wiring: store + injectable seams
# =============================================================================
# WHY everything external is an injected callable: preflight (Docker),
# controller start/abort (k6 + fault injector) and system reset (Docker
# sweep) cannot run on machines without those binaries — including this dev
# box and CI. The ROUTES are still real and testable: tests inject fakes,
# production wires the real implementations when available. A `None` seam
# returns 501 with an honest message ("controller not wired") instead of
# pretending to succeed — no silent fake success in production paths.
#
# WHY an in-process Broadcaster for SSE: one experiment at a time (global
# lock), N dashboard tabs subscribe to the same run. asyncio.Queue per
# subscriber, publish fans out. Survives backend restart = clients reconnect
# and fall back to GET /samples polling (spec F2 fallback).
# =============================================================================

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import UUID

from core.schemas.experiment import ExperimentCreate, PreflightResult
from core.store import Store


@dataclass
class Broadcaster:
    """Fan-out of SSE messages to current subscribers.

    publish() is called from WHATEVER thread the producer lives in: the
    controller task (event loop), a metrics collector thread, or a test's
    main thread. asyncio.Queue is not thread-safe — waking a getter from the
    wrong thread can silently stall delivery until the next timeout. So each
    subscriber records the loop it was created on (subscribe runs inside the
    route handler, where the loop is running), and publish marshals with
    call_soon_threadsafe whenever it's on the wrong thread.

    Backpressure: a subscriber that stops reading fills its queue — maxsize
    1000 then drop-oldest (a stalled tab must never stall the experiment; the
    tab falls back to polling and misses nothing durable — buckets are in
    the store)."""

    _subs: dict[asyncio.Queue, asyncio.AbstractEventLoop] = field(default_factory=dict)
    _maxsize: int = 1000

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self._maxsize)
        self._subs[q] = asyncio.get_running_loop()
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.pop(q, None)

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)

    def publish(self, event: str, data: dict) -> None:
        message = {"event": event, "data": data}
        for q, loop in list(self._subs.items()):
            if loop is _current_loop():
                _enqueue(q, message)
            else:
                # Foreign thread → hand the enqueue to the owning loop.
                loop.call_soon_threadsafe(_enqueue, q, message)


def _current_loop() -> asyncio.AbstractEventLoop | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def _enqueue(q: asyncio.Queue, message: dict) -> None:
    """Must run ON q's loop (see Broadcaster.publish). Drop-oldest on full:
    the live chart is lossy by design — the store is the source of truth."""
    try:
        q.put_nowait(message)
    except asyncio.QueueFull:
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            pass


# Seam signatures ---------------------------------------------------------------

PreflightFn = Callable[[ExperimentCreate], PreflightResult]
StartFn = Callable[[UUID], None]
AbortFn = Callable[[UUID], None]
ResetFn = Callable[[], dict]


@dataclass
class AppState:
    """Attached to FastAPI app.state; routes reach it via request.app.state."""

    store: Store
    preflight: PreflightFn | None = None
    start_experiment: StartFn | None = None
    abort_experiment: AbortFn | None = None
    reset_system: ResetFn | None = None
    broadcaster: Broadcaster = field(default_factory=Broadcaster)

    def sse_data(self, event: str, data: dict) -> bytes:
        """Wire format helper shared by route + tests (single source for the
        framing rules: `event:` line, `data:` line, blank line separator)."""
        payload = json.dumps(data, separators=(",", ":"), default=str)
        return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


def create_live_state(
    store: Store | None = None,
    docker_client: object | None = None,
    k6_bin: str = "k6",
) -> AppState:
    """Creates a fully wired AppState for production or Docker container runs."""
    from core.controller.experiment import ExperimentController
    from core.safety.preflight import run_preflight
    from core.store import Store

    actual_store = store if store is not None else Store()
    broadcaster = Broadcaster()
    controller = ExperimentController(
        store=actual_store,
        broadcaster=broadcaster,
        docker_client=docker_client,
        k6_bin=k6_bin,
    )

    def preflight_handler(exp: ExperimentCreate) -> PreflightResult:
        return run_preflight(exp, docker_client=docker_client)

    def start_handler(exp_id: UUID) -> None:
        controller.start(exp_id)

    def abort_handler(exp_id: UUID) -> None:
        controller.abort(exp_id)

    def reset_handler() -> dict:
        restored = []
        if docker_client:
            try:
                for c in getattr(docker_client, "containers").list(all=True):
                    labels = getattr(c, "labels", {}) or {}
                    if "blastradius.faulted-by" in labels:
                        c.start()
                        restored.append(getattr(c, "name", str(c)))
            except Exception:
                pass
        return {"status": "ok", "restored": restored}

    return AppState(
        store=actual_store,
        preflight=preflight_handler,
        start_experiment=start_handler,
        abort_experiment=abort_handler,
        reset_system=reset_handler,
        broadcaster=broadcaster,
    )
