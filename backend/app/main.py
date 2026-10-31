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
# reports (report/fix-prompt/compare), stream (SSE), site (landing page:
# waitlist + public stats).
#
# CORS: the dashboard dev server (Vite, :5173) is a different origin from the
# API (:8000). Allowed origins come from BR_CORS_ORIGINS (comma-separated) so
# a deployed site can be added without a code change.
# =============================================================================

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api import architecture, experiments, reports, site, stream
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
    origins = os.environ.get(
        "BR_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins.split(",") if o.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(architecture.router)
    app.include_router(experiments.router)
    app.include_router(reports.router)
    app.include_router(stream.router)
    app.include_router(site.router)

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
