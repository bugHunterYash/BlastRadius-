"""Project workspaces: real project folders (not under AGENT_WORKSPACE_ROOT) that agents can be given work in.

A folder can only be added when an agent session synced from the Claude, Codex or Antigravity app
already works in it (or in a folder inside it), so the tower never opens up an arbitrary path.
Tasks in a project run read-only unless the person allows edits for that task.
"""

import hashlib
import re
from pathlib import Path

from app import db
from app.runtime import workspace


class ProjectError(ValueError):
    pass


def _norm(p: str | Path) -> Path:
    return Path(p).expanduser().resolve()


def _id_for(path: Path) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", path.name.lower()).strip("-")[:40] or "project"
    return f"proj-{slug}-{hashlib.sha1(str(path).lower().encode()).hexdigest()[:6]}"


async def load() -> None:
    rows = await db.pool.fetch("SELECT workspace_id, path FROM project_workspaces")
    workspace.set_projects({r["workspace_id"]: r["path"] for r in rows})


async def list_projects() -> list[dict]:
    rows = await db.pool.fetch("SELECT workspace_id, path, name, created_at FROM project_workspaces ORDER BY created_at")
    return [db._out(r) for r in rows]


async def register(path: str) -> dict:
    target = _norm(path)
    if not target.is_dir():
        raise ProjectError(f"{path!r} is not a folder on this machine")
    cwds = await db.pool.fetch(
        "SELECT DISTINCT metadata->>'cwd' AS cwd FROM agent_invocations WHERE runtime IN "
        "('claude_code_import', 'codex_app_import', 'antigravity_app_import') AND metadata->>'cwd' IS NOT NULL")
    known = [_norm(r["cwd"]) for r in cwds]
    if not any(k == target or k.is_relative_to(target) for k in known):
        raise ProjectError("only folders where a synced Claude, Codex or Antigravity session works can be added")
    if target == Path(target.anchor) or target == Path.home().resolve():
        raise ProjectError("a drive root or your home folder is too broad; pick the project folder")
    wid = _id_for(target)
    row = await db.pool.fetchrow(
        "INSERT INTO project_workspaces (workspace_id, path, name) VALUES ($1, $2, $3) "
        "ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name RETURNING workspace_id, path, name, created_at",
        wid, str(target), target.name)
    await load()
    return db._out(row)
