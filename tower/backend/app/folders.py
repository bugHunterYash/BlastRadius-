"""Folders the person allowed: the tower only shows chats from the Claude, Codex and Antigravity apps that work in
one of them. A new install allows none, so nothing personal appears until someone signs in and picks folders.

Folders the apps work in but aren't allowed are remembered by path only (seen_folders), so the UI can offer them.
"""

from pathlib import Path

from app import db
from app.config import settings

_allowed: list[Path] = []       # cached for the sync loop; reloaded on every change


def _norm(p: str | Path) -> Path:
    return Path(p).expanduser().resolve()


async def load() -> None:
    rows = await db.pool.fetch("SELECT path FROM allowed_folders")
    _allowed[:] = [_norm(r["path"]) for r in rows]


def permits(cwd: str | None) -> bool:
    """A chat working in this folder may be synced."""
    if not settings.LIVE_SYNC_ALLOWED_FOLDERS_ONLY:
        return True
    if not cwd:
        return False
    try:
        here = _norm(cwd)
    except (OSError, ValueError):
        return False
    return any(here == a or here.is_relative_to(a) for a in _allowed)


async def note_seen(cwd: str | None, app: str) -> None:
    """Remember that an app has a chat in a folder that isn't allowed (the path only)."""
    if not cwd:
        return
    try:
        path = str(_norm(cwd))
    except (OSError, ValueError):
        return
    await db.pool.execute(
        """INSERT INTO seen_folders (path, apps, chats) VALUES ($1, ARRAY[$2], 1)
           ON CONFLICT (path) DO UPDATE SET last_seen = clock_timestamp(),
             apps = CASE WHEN $2 = ANY(seen_folders.apps) THEN seen_folders.apps ELSE seen_folders.apps || $2 END""",
        path, app)


async def listing() -> dict:
    allowed = [db._out(r) for r in await db.pool.fetch(
        "SELECT path, name, allowed_by, allowed_at FROM allowed_folders ORDER BY allowed_at")]
    seen = [db._out(r) for r in await db.pool.fetch(
        "SELECT path, apps, last_seen FROM seen_folders ORDER BY last_seen DESC LIMIT 100")]
    return {"enforced": settings.LIVE_SYNC_ALLOWED_FOLDERS_ONLY, "allowed": allowed,
            "suggested": [s for s in seen if not permits(s["path"])]}


class FolderError(ValueError):
    pass


async def allow(path: str, by: str | None = None) -> dict:
    target = _norm(path)
    if not target.is_dir():
        raise FolderError(f"{path!r} is not a folder on this machine")
    if target == Path(target.anchor) or target == Path.home().resolve():
        raise FolderError("a drive root or your home folder is too broad; pick the project folder")
    row = await db.pool.fetchrow(
        "INSERT INTO allowed_folders (path, name, allowed_by) VALUES ($1, $2, $3) "
        "ON CONFLICT (path) DO UPDATE SET allowed_by = COALESCE(EXCLUDED.allowed_by, allowed_folders.allowed_by) "
        "RETURNING path, name, allowed_by, allowed_at",
        str(target), target.name, by)
    await load()
    return db._out(row)


async def revoke(path: str) -> bool:
    done = await db.pool.execute("DELETE FROM allowed_folders WHERE path = $1", str(_norm(path)))
    await load()
    return done.endswith(" 1")
