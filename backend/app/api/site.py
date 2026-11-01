# =============================================================================
# backend.app.api.site — landing page: waitlist signup + public stats
# =============================================================================
# The landing page is the only surface that talks to strangers, so this
# router is deliberately small: one write (join the waitlist) and one read
# (counts). Stats are read from the store, never hard-coded, so the page can
# only show numbers that exist.
#
# Email check is a pattern, not deliverability: we don't send mail from the
# hackathon build, and pulling in email-validator for one field isn't worth
# the dependency.
# =============================================================================

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field, field_validator

from core.store import NotFound

router = APIRouter(prefix="/api/site", tags=["site"])

Plan = Literal["free", "pro", "team", "enterprise"]


class WaitlistJoin(BaseModel):
    email: str = Field(
        min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    )
    plan: Plan = "pro"

    @field_validator("email", mode="before")
    @classmethod
    def normalise(cls, v: object) -> object:
        # One person = one row, however they typed it.
        return v.strip().lower() if isinstance(v, str) else v


class WaitlistJoined(BaseModel):
    status: Literal["joined", "already_joined"]
    position: int


class SiteStats(BaseModel):
    waitlist: int
    experiments: int
    reports: int


@router.post("/waitlist", response_model=WaitlistJoined)
def join_waitlist(body: WaitlistJoin, request: Request, response: Response) -> WaitlistJoined:
    store = request.app.state.br.store
    created, position = store.join_waitlist(body.email, body.plan)
    response.status_code = 201 if created else 200
    return WaitlistJoined(
        status="joined" if created else "already_joined", position=position
    )


@router.get("/stats", response_model=SiteStats)
def stats(request: Request) -> SiteStats:
    store = request.app.state.br.store
    experiments = store.list_experiments()
    reports = 0
    for exp in experiments:
        try:
            store.get_report(exp.id)
            reports += 1
        except NotFound:
            continue
    return SiteStats(
        waitlist=store.waitlist_count(), experiments=len(experiments), reports=reports
    )
