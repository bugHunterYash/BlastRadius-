from fastapi import APIRouter, Depends, HTTPException, Query

from app import meko_client
from app.config import settings
from app.models import NotebookWrite
from app.routers.deps import require_ingest_token

router = APIRouter(tags=["notebook"])


@router.get("/v1/notebook")
async def search(q: str | None = None, limit: int = Query(50, ge=1, le=500), datapack: str | None = None):
    """Shared notebook contents, newest first. Proxies Meko when it is configured."""
    return await meko_client.search(q, limit, datapack)


@router.post("/v1/notebook", dependencies=[Depends(require_ingest_token)])
async def write(body: NotebookWrite):
    """Local notebook write, used by the SDK when MEKO_MCP_URL is not set."""
    if settings.notebook_mode == "meko":
        raise HTTPException(409, "Meko is configured: agents write to Meko directly")
    return {"ref": await meko_client.write(body.text, body.kind, body.datapack)}
