"""Connecting Claude and Codex accounts from the UI, against fakes of each provider's own CLI/protocol."""

import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.runtime import auth
from tests.fakes import FAKE_CODEX

AUTH = {"Authorization": "Bearer test-token"}
FAKE_CLI = Path(__file__).with_name("fake_claude_cli.py")


@pytest.fixture
def fake_cli(tmp_path, monkeypatch):
    """The fake CLI, launched with the same `auth ...` arguments as the real claude(.exe)."""
    monkeypatch.setenv("FAKE_CLAUDE_STATE", str(tmp_path / "logged-in"))
    monkeypatch.setattr(auth, "claude_argv", lambda: [sys.executable, str(FAKE_CLI)])
    monkeypatch.setattr(auth, "codex_argv", lambda: FAKE_CODEX)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    auth._sessions.clear()
    auth.invalidate_status()
    return tmp_path


@pytest.fixture
def client(fresh_db, fake_cli):
    from app.main import app

    with TestClient(app) as c:
        yield c


def wait_login(c, provider, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        st = c.get("/v1/agents/auth", headers=AUTH).json()[provider]
        if st["login"] and st["login"]["status"] != "pending":
            return st
        time.sleep(0.2)
    raise AssertionError("login did not finish")


def test_auth_endpoints_need_the_token(client):
    assert client.get("/v1/agents/auth").status_code == 401
    assert client.post("/v1/agents/auth/claude/login").status_code == 401
    assert client.post("/v1/agents/auth/gemini/login", headers=AUTH).status_code == 422


def test_claude_login_flow_returns_url_and_ends_logged_in(client):
    before = client.get("/v1/agents/auth", headers=AUTH).json()["claude"]
    assert before["logged_in"] is False and before["login"] is None

    started = client.post("/v1/agents/auth/claude/login", headers=AUTH).json()
    assert started["status"] in ("pending", "succeeded")
    assert started["url"].startswith("https://claude.ai/oauth/authorize")

    after = wait_login(client, "claude")
    assert after["login"]["status"] == "succeeded" and after["logged_in"] is True
    assert after["auth_method"] == "claude.ai" and after["subscription"] == "pro"
    assert "example.com" not in str(after)                     # no email leaves the server


def test_claude_login_failure_is_reported(client, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_FAIL", "1")
    client.post("/v1/agents/auth/claude/login", headers=AUTH)
    st = wait_login(client, "claude")
    assert st["login"]["status"] == "failed" and "access denied" in st["login"]["message"]
    assert st["logged_in"] is False


def test_codex_login_flow(client, monkeypatch):
    monkeypatch.setenv("FAKE_CODEX_MODE", "ok")
    started = client.post("/v1/agents/auth/codex/login", headers=AUTH).json()
    assert started["url"] == "https://auth.openai.com/oauth/authorize?test=1"
    st = wait_login(client, "codex")
    assert st["login"]["status"] == "succeeded" and st["logged_in"] is True
    assert st["auth_method"] == "chatgpt" and "example.com" not in str(st)


def test_cancel_when_nothing_is_running(client):
    assert client.post("/v1/agents/auth/claude/cancel", headers=AUTH).status_code == 409
