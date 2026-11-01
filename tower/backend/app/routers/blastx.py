"""BlastX: map an architecture from a compose file with the BlastRadius engine, and show what a failure breaks.

The compose file is the bundled demo stack, or one found inside a project folder already opened to the
agents (app.projects). Only compose files are read, never anything else in the folder.
"""

import hashlib
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.runtime import workspace

router = APIRouter(tags=["blastx"])
COMPOSE_NAMES = ("compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml")
MAX_BYTES = 256 * 1024
_graphs: dict[str, dict] = {}        # content hash -> parsed graph, so the same file isn't parsed twice


def compose_files(root: Path) -> list[Path]:
    """Compose files at the top of the folder or one level down (e.g. demo-app/compose.yaml)."""
    found = [root / n for n in COMPOSE_NAMES if (root / n).is_file()]
    for sub in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith((".", "node_modules"))):
        found += [sub / n for n in COMPOSE_NAMES if (sub / n).is_file()]
    return [f for f in found if workspace.contains(root, f)]


async def _engine(method: str, path: str, **kw):
    try:
        async with httpx.AsyncClient(base_url=settings.BLASTX_URL, timeout=20) as c:
            r = await c.request(method, path, **kw)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"BlastRadius engine not reachable at {settings.BLASTX_URL}") from exc
    if r.status_code >= 400:
        raise HTTPException(r.status_code if r.status_code < 500 else 502, f"engine: {r.text[:300]}")
    return r.json()


@router.get("/v1/blastx/architecture")
async def architecture(workspace_id: str | None = None, file: str | None = Query(None, max_length=300)):
    if workspace_id:
        try:
            root = workspace.resolve(workspace_id)
        except workspace.WorkspaceError as exc:
            raise HTTPException(422, str(exc)) from exc
        files = compose_files(root)
        if not files:
            raise HTTPException(404, "no compose file in this project (compose.yaml or docker-compose.yml)")
        chosen = next((f for f in files if f.relative_to(root).as_posix() == file), files[0]) if file else files[0]
        label, options = chosen.relative_to(root).as_posix(), [f.relative_to(root).as_posix() for f in files]
    else:
        chosen, label, options = Path(settings.BLASTX_DEMO_COMPOSE), "demo stack", []
    if not chosen.is_file() or chosen.stat().st_size > MAX_BYTES:
        raise HTTPException(422, "compose file missing or larger than 256 KB")
    content = chosen.read_text(encoding="utf-8", errors="replace")
    key = hashlib.sha256(content.encode()).hexdigest()
    if key not in _graphs:
        _graphs[key] = await _engine("POST", "/api/architecture/parse",
                                     json={"content": content, "filename": chosen.name, "name": label})
    return {"source": label, "files": options, "graph": _graphs[key]}


@router.get("/v1/blastx/impact/{graph_id}/{service}")
async def impact(graph_id: uuid.UUID, service: str):
    if not all(ch.isalnum() or ch in "-_." for ch in service) or len(service) > 120:
        raise HTTPException(422, "invalid service name")
    return await _engine("GET", f"/api/architecture/{graph_id}/impact/{service}")
