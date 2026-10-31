"""Agent Control Tower backend: runs Claude Code and Codex agents, captures what they do (prompts,
responses, tools, commands, files) and what they read and write in the shared notebook, then turns
that into issues, digests and fixes."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db, execution, pipeline
from app.runtime import auth as agent_auth
from app.agents import fixer, summarizer
from app.config import DEV_TOKEN, settings
from app.routers import (agents, approvals, blast, design, events, issues, notebook, runs, sessions, stream,
                         timeline)

log = logging.getLogger("tower")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO)
    if settings.TOWER_INGEST_TOKEN == DEV_TOKEN:
        log.warning("TOWER_INGEST_TOKEN is the dev default; set a real secret before deploying")
    await db.init()
    task = pipeline.start()
    execution.start()
    yield
    await execution.shutdown()
    await agent_auth.shutdown()
    task.cancel()
    await db.close()


app = FastAPI(title="Agent Control Tower", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "Authorization"],
)
for r in (events, runs, issues, timeline, design, approvals, blast, notebook, stream, agents, sessions):
    app.include_router(r.router)


@app.get("/v1/health", tags=["meta"])
async def health():
    """What is real and what is a stand-in, so the UI can say so."""
    return {
        "db": await db.health(),
        "notebook": settings.notebook_mode,
        "summarizer": summarizer.label(),
        "fixer": settings.CLAUDE_MODEL if fixer.enabled() else "template",
    }
