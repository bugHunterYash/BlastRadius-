"""Workspace allowlisting: agents only ever run inside a named directory under AGENT_WORKSPACE_ROOT."""

import re
from pathlib import Path

from app.config import settings

_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


class WorkspaceError(ValueError):
    pass


def root() -> Path:
    return Path(settings.AGENT_WORKSPACE_ROOT).resolve()


def resolve(workspace_id: str) -> Path:
    """The real path of an allowed workspace. Symlinks are resolved before the containment check,
    so a link pointing outside the root is refused."""
    if not _ID.match(workspace_id or ""):
        raise WorkspaceError(f"invalid workspace id {workspace_id!r}")
    allowed = [w.strip() for w in settings.AGENT_WORKSPACES.split(",") if w.strip()]
    if allowed and workspace_id not in allowed:
        raise WorkspaceError(f"workspace {workspace_id!r} is not in AGENT_WORKSPACES")
    base = root()
    path = (base / workspace_id).resolve()
    if not path.is_relative_to(base) or path == base:
        raise WorkspaceError(f"workspace {workspace_id!r} escapes the workspace root")
    if not path.is_dir():
        raise WorkspaceError(f"workspace {workspace_id!r} does not exist under {base}")
    return path


def contains(workspace: Path, candidate: str | Path) -> bool:
    """True if candidate (absolute, or relative to the workspace) stays inside it after resolving links."""
    p = Path(candidate)
    p = (p if p.is_absolute() else workspace / p).resolve()
    return p == workspace or p.is_relative_to(workspace)
