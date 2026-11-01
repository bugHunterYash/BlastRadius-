from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app import meko_client
from app.config import settings
from app.models import NotebookWrite
from app.routers.deps import require_ingest_token

router = APIRouter(tags=["notebook"])


@router.get("/v1/notebook")
async def search(q: str | None = None, limit: int = Query(50, ge=1, le=500), datapack: str | None = None):
    """Shared notebook contents, newest first. Proxies Meko when it is configured."""
    return await meko_client.search(q, limit, datapack)


class MemorySwitch(BaseModel):
    sharing: bool


@router.get("/v1/memory/mode")
async def memory_mode():
    """The Meko switch: whether agents share memory, and where it goes ("meko", "local" or "off")."""
    return {"sharing": meko_client.sharing(), "mode": meko_client.mode(), "meko_configured": settings.notebook_mode == "meko"}


@router.put("/v1/memory/mode")
async def set_memory_mode(body: MemorySwitch):
    """Turn Meko on or off. Off: agents in new tasks work alone (they neither read nor write shared memory)."""
    await meko_client.set_sharing(body.sharing)
    return await memory_mode()


@router.post("/v1/notebook", dependencies=[Depends(require_ingest_token)])
async def write(body: NotebookWrite):
    """Local notebook write, used by the SDK when MEKO_MCP_URL is not set."""
    if settings.notebook_mode == "meko":
        raise HTTPException(409, "Meko is configured: agents write to Meko directly")
    return {"ref": await meko_client.write(body.text, body.kind, body.datapack)}
