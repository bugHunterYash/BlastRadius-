"""Connect the agent runtimes to their accounts from the UI, using each provider's own login flow.

Claude: runs the official CLI, `claude auth login --claudeai`. It opens Anthropic's sign-in page
(where "Continue with Google" lives) in the browser on this machine and saves the login for the
CLI that the Claude runtime uses. `claude auth status` reports the result.

Codex: asks the app-server for a ChatGPT login (`account/login/start {type: "chatgpt"}` -> authUrl)
and waits for `account/login/completed`.

The tower never sees a password or token: the person signs in on the provider's own page, and the
provider's CLI stores the credential. Status responses carry the auth method and plan, never emails.
"""

import asyncio
import contextlib
import datetime as dt
import json
import logging
import os
import re
from dataclasses import dataclass, field

from app.runtime.base import RuntimeError_
from app.runtime.claude_sdk import cli_path
from app.runtime.codex_app_server import CLIENT_INFO, JsonRpcConnection, codex_argv

log = logging.getLogger("tower.auth")
LOGIN_TIMEOUT_S = 600
_URL = re.compile(r"https://[^\s\"'<>]+")
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


@dataclass
class LoginSession:
    provider: str
    status: str = "pending"                 # pending | succeeded | failed | cancelled
    url: str | None = None
    message: str = "starting the provider's sign-in"
    started_at: str = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc).isoformat())
    finished_at: str | None = None
    task: asyncio.Task | None = None
    proc: asyncio.subprocess.Process | None = None
    conn: JsonRpcConnection | None = None
    login_id: str | None = None

    def public(self) -> dict:
        return {"provider": self.provider, "status": self.status, "url": self.url, "message": self.message,
                "started_at": self.started_at, "finished_at": self.finished_at}

    def finish(self, status: str, message: str) -> None:
        if self.status == "pending":
            self.status, self.message = status, message
            self.finished_at = dt.datetime.now(dt.timezone.utc).isoformat()
            invalidate_status()


_sessions: dict[str, LoginSession] = {}


def claude_argv() -> list[str] | None:
    """The Claude Code CLI as an argv prefix (tests swap in a fake)."""
    path = cli_path()
    return [path] if path else None


# ---------- status ----------

async def claude_status() -> dict:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return {"provider": "claude", "logged_in": True, "auth_method": "api_key"}
    argv = claude_argv()
    if not argv:
        return {"provider": "claude", "logged_in": False, "auth_method": None, "detail": "Claude Code CLI not found"}
    try:
        proc = await asyncio.create_subprocess_exec(*argv, "auth", "status", stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.PIPE)
        out, _ = await asyncio.wait_for(proc.communicate(), 30)
        data = json.loads(out.decode(errors="replace") or "{}")
    except (OSError, asyncio.TimeoutError, ValueError) as exc:
        return {"provider": "claude", "logged_in": False, "auth_method": None, "detail": f"status check failed: {exc!r}"}
    # Only non-identifying fields leave the server.
    return {"provider": "claude", "logged_in": bool(data.get("loggedIn")), "auth_method": data.get("authMethod"),
            "subscription": data.get("subscriptionType")}


async def codex_status() -> dict:
    conn = JsonRpcConnection(codex_argv())
    try:
        await conn.start()
        await conn.request("initialize", {"clientInfo": CLIENT_INFO}, timeout=20)
        await conn.notify("initialized")
        acct = await conn.request("account/read", {}, timeout=20) or {}
    except (OSError, RuntimeError_, asyncio.TimeoutError) as exc:
        return {"provider": "codex", "logged_in": False, "auth_method": None, "detail": f"status check failed: {exc!r}"}
    finally:
        await conn.close()
    account = acct.get("account")
    return {"provider": "codex", "logged_in": account is not None, "auth_method": account.get("type") if account else None,
            "subscription": account.get("planType") if account else None}


STATUS_TTL_S = 15.0
_status_cache: tuple[float, dict] | None = None


def invalidate_status() -> None:
    global _status_cache
    _status_cache = None


async def status() -> dict:
    """Checking sign-in starts each provider's CLI (seconds each), so the result is reused for a few
    seconds; any sign-in starting or finishing drops the cache."""
    global _status_cache
    now = asyncio.get_running_loop().time()
    if _status_cache and now - _status_cache[0] < STATUS_TTL_S:
        claude, codex = (dict(v) for v in _status_cache[1])
    else:
        claude, codex = await asyncio.gather(claude_status(), codex_status())
        _status_cache = (now, (dict(claude), dict(codex)))
    for s in (claude, codex):
        session = _sessions.get(s["provider"])
        s["login"] = session.public() if session else None
    return {"claude": claude, "codex": codex}


# ---------- Claude login ----------

async def _claude_login(session: LoginSession) -> None:
    argv = claude_argv()
    if not argv:
        session.finish("failed", "Claude Code CLI not found (install claude-agent-sdk)")
        return
    proc = await asyncio.create_subprocess_exec(
        *argv, "auth", "login", "--claudeai", stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    session.proc = proc
    session.message = "opening Anthropic's sign-in page in your browser"
    lines: list[str] = []
    try:
        async def read():
            assert proc.stdout
            while raw := await proc.stdout.readline():
                line = _ANSI.sub("", raw.decode(errors="replace")).strip()
                if not line:
                    continue
                lines.append(line)
                if (m := _URL.search(line)) and not session.url:
                    session.url = m.group(0)
                    session.message = "finish signing in on the page that opened (or open the link)"
        await asyncio.wait_for(asyncio.gather(read(), proc.wait()), LOGIN_TIMEOUT_S)
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        session.finish("failed", "sign-in timed out")
        return
    st = await claude_status()
    if st["logged_in"]:
        session.finish("succeeded", f"Claude connected ({st.get('auth_method')})")
    else:
        tail = " | ".join(lines[-3:])[:300]
        session.finish("failed", f"sign-in did not complete (exit {proc.returncode}): {tail}")


async def submit_claude_code(code: str) -> bool:
    """Some sign-in flows show a code to paste back into the CLI."""
    s = _sessions.get("claude")
    if not s or s.status != "pending" or not s.proc or not s.proc.stdin:
        return False
    s.proc.stdin.write((code.strip() + "\n").encode())
    await s.proc.stdin.drain()
    return True


# ---------- Codex login ----------

async def _codex_login(session: LoginSession) -> None:
    conn = JsonRpcConnection(codex_argv())
    session.conn = conn
    try:
        await conn.start()
        await conn.request("initialize", {"clientInfo": CLIENT_INFO}, timeout=20)
        await conn.notify("initialized")
        res = await conn.request("account/login/start", {"type": "chatgpt"}, timeout=30) or {}
        session.url, session.login_id = res.get("authUrl"), res.get("loginId")
        session.message = "finish signing in to ChatGPT on the page that opened (or open the link)"

        async def wait_done():
            while True:
                msg = await conn.notifications.get()
                if msg is None:
                    return {"success": False, "error": "codex app-server exited"}
                if msg.get("method") == "account/login/completed":
                    return msg.get("params") or {}

        done = await asyncio.wait_for(wait_done(), LOGIN_TIMEOUT_S)
        if done.get("success"):
            session.finish("succeeded", "Codex connected")
        else:
            session.finish("failed", f"sign-in failed: {done.get('error') or 'unknown error'}")
    except asyncio.TimeoutError:
        session.finish("failed", "sign-in timed out")
    except (OSError, RuntimeError_) as exc:
        session.finish("failed", f"could not start Codex sign-in: {exc}")
    finally:
        await conn.close()


# ---------- shared ----------

async def start_login(provider: str) -> dict:
    current = _sessions.get(provider)
    if current and current.status == "pending":
        return current.public()
    session = LoginSession(provider=provider)
    _sessions[provider] = session
    invalidate_status()
    runner = {"claude": _claude_login, "codex": _codex_login}[provider]

    async def run():
        try:
            await runner(session)
        except Exception as exc:  # never leave a login stuck in "pending"
            log.exception("%s login crashed", provider)
            session.finish("failed", f"{type(exc).__name__}: {exc}")

    session.task = asyncio.create_task(run())
    # Give the provider a moment to print/return the sign-in URL so the UI can show it right away.
    for _ in range(30):
        if session.url or session.status != "pending":
            break
        await asyncio.sleep(0.2)
    return session.public()


async def cancel_login(provider: str) -> bool:
    s = _sessions.get(provider)
    if not s or s.status != "pending":
        return False
    if s.provider == "codex" and s.conn and s.login_id:
        with contextlib.suppress(Exception):
            await s.conn.request("account/login/cancel", {"loginId": s.login_id}, timeout=5)
    if s.proc and s.proc.returncode is None:
        with contextlib.suppress(ProcessLookupError):
            s.proc.kill()
    if s.task:
        s.task.cancel()
    s.finish("cancelled", "sign-in cancelled")
    return True


async def shutdown() -> None:
    for p in list(_sessions):
        await cancel_login(p)
