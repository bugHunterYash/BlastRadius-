import uuid

from fastapi import APIRouter, HTTPException

from app import db

router = APIRouter(tags=["blast radius"])


@router.get("/v1/blast-radius")
async def blast_radius(event_id: uuid.UUID):
    """BlastX: every read of one written version, and everything those agents wrote after, up to 5 hops."""
    found = await db.blast_radius(event_id)
    if found is None:
        raise HTTPException(404, "event not found")
    return found
