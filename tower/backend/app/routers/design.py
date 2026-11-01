from fastapi import APIRouter

from app import db, stream
from app.models import DesignSpec

router = APIRouter(tags=["design"])


@router.get("/v1/design")
async def get_design():
    return await db.get_design()


@router.put("/v1/design")
async def put_design(spec: DesignSpec):
    saved = await db.save_design(spec.model_dump(mode="json"))
    await stream.publish("design.updated", saved)
    return saved


@router.get("/v1/design/history")
async def history():
    return await db.design_history()
