"""Tests run against a throwaway database (tower_test) on the same server as DATABASE_URL.

Start PostgreSQL with:  docker run -d --name tower-pg -e POSTGRES_PASSWORD=tower -e POSTGRES_DB=tower -p 5433:5432 postgres:16-alpine
Database tests are skipped when no server is reachable. LLMs are switched off so results are deterministic.
"""

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

TOWER = Path(__file__).resolve().parents[2]
BASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:tower@localhost:5433/tower")
TEST_URL = urlunparse(urlparse(BASE_URL)._replace(path="/tower_test"))

CONFIG_DIR = Path(tempfile.mkdtemp(prefix="tower-config-"))
for f in (TOWER / "demo-agents" / "config.defaults").glob("*.yaml"):
    shutil.copy(f, CONFIG_DIR / f.name)

WORKSPACES = Path(tempfile.mkdtemp(prefix="tower-ws-"))
(WORKSPACES / "demo-workspace").mkdir()
(WORKSPACES / "demo-workspace" / "pricing.md").write_text("| Aqua bottle | ₹549 |\n", encoding="utf-8")
(WORKSPACES / "other-workspace").mkdir()

os.environ.update(
    DATABASE_URL=TEST_URL, AGENT_CONFIG_DIR=str(CONFIG_DIR), OLLAMA_MODEL="", ANTHROPIC_API_KEY="",
    MEKO_MCP_URL="", TOWER_INGEST_TOKEN="test-token", TOWER_API_TOKEN="", APPLY_GIT_COMMIT="false",
    AGENT_WORKSPACE_ROOT=str(WORKSPACES), AGENT_WORKSPACES="", CLAUDE_RUNTIME_ENABLED="true",
    CODEX_RUNTIME_ENABLED="true", REPLAY_RUNTIME_ENABLED="false", CLAUDE_AGENT_MODEL="", CODEX_MODEL="", LIVE_SYNC_ENABLED="false",
    ANTIGRAVITY_BIN=str(WORKSPACES / "no-agy"), ANTIGRAVITY_DIR=str(WORKSPACES / "no-antigravity"),
)


async def _reset_db() -> bool:
    import asyncpg

    try:
        admin = await asyncpg.connect(BASE_URL, timeout=3)
    except (OSError, asyncpg.PostgresError, asyncio.TimeoutError):
        return False
    try:
        if not await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = 'tower_test'"):
            await admin.execute("CREATE DATABASE tower_test")
    finally:
        await admin.close()
    c = await asyncpg.connect(TEST_URL)
    await c.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    await c.close()
    return True


@pytest.fixture
def fresh_db():
    if not asyncio.run(_reset_db()):
        pytest.skip("no Postgres/YugabyteDB reachable at DATABASE_URL")
    for f in (TOWER / "demo-agents" / "config.defaults").glob("*.yaml"):
        shutil.copy(f, CONFIG_DIR / f.name)
    return TEST_URL


@pytest.fixture
def config_dir():
    return CONFIG_DIR


@pytest.fixture
def workspaces():
    return WORKSPACES


# Every API route but health and ingest needs the API token, so test clients send it by default.
# A test checks the 401 by sending NO_TOKEN instead.
NO_TOKEN = {"Authorization": ""}
from fastapi.testclient import TestClient as _TestClient  # noqa: E402

_client_init = _TestClient.__init__


def _client_with_token(self, *args, headers=None, **kwargs):
    _client_init(self, *args, headers={"Authorization": "Bearer test-token", **(headers or {})}, **kwargs)


_TestClient.__init__ = _client_with_token
