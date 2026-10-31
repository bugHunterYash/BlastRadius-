# =============================================================================
# backend.app.main — FastAPI application factory
# =============================================================================
# create_app(state) takes ALL external seams via AppState (store, preflight,
# controller fns, broadcaster). Tests build an app with an in-memory store +
# fakes in ~3 lines; production builds it with a file store and — when the
# environment provides them — the real Docker/k6 implementations. Nothing is
# imported lazily or monkeypatched; wiring is explicit at construction.
#
# Routers: architecture (parse/graph/impact), experiments (lifecycle/samples),
# reports (report/fix-prompt/compare), stream (SSE).
# =============================================================================

from __future__ import annotations

from fastapi import FastAPI

from backend.app.api import architecture, auth, experiments, reports, stream
from backend.app.state import AppState


def create_app(state: AppState) -> FastAPI:
    app = FastAPI(
        title="BlastRadius API",
        version="0.1.0",
        description=(
            "Resilience & capacity testing for Docker Compose apps: "
            "architecture graph, preflight, load/fault experiments, "
            "measured reports, deterministic fix prompts."
        ),
    )
    app.state.br = state
    app.include_router(architecture.router)
    app.include_router(experiments.router)
    app.include_router(reports.router)
    app.include_router(stream.router)
    app.include_router(auth.router)

    @app.get("/api/system/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.post("/api/system/reset")
    def system_reset() -> dict:
        if state.reset_system is None:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=501,
                detail="system reset not wired on this build (requires Docker)",
            )
        return state.reset_system()

    return app


# Default ASGI application instance for uvicorn / Docker runners
from backend.app.state import create_live_state  # noqa: E402
app = create_app(create_live_state())
