# =============================================================================
# backend.app.api.reports — stored report / fix prompt / compare (E1, E2)
# =============================================================================
# fix-prompt is regenerated ON THE FETCH from the stored report (spec: "E1 on
# the fly") — safe because generate_fix_prompt is deterministic: the bytes
# match what finalize_report stored, and regenerating lets late-attached
# repo hints differ without rewriting the stored report. compare reads TWO
# stored reports through the same fairness-policed core function the CLI
# uses — one implementation, both surfaces.
# =============================================================================

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

from core.analysis import compare
from core.report import generate_fix_prompt
from core.schemas.report import Comparison, Report
from core.store import NotFound

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _get_report(request: Request, report_id: UUID) -> Report:
    try:
        return request.app.state.br.store.get_report(report_id)
    except NotFound as e:
        # Route id IS the experiment id (1:1 report ↔ run) — the detail
        # message says so, because "report for experiment X not found" tells
        # the caller which id space they're in.
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/{report_id}", response_model=Report)
def get_report(report_id: UUID, request: Request) -> Report:
    return _get_report(request, report_id)


@router.get("/{report_id}/fix-prompt")
def fix_prompt(report_id: UUID, request: Request, repo_hint: str | None = None) -> dict:
    report = _get_report(request, report_id)
    return {
        "experiment_id": report.experiment_id,
        "fix_prompt": generate_fix_prompt(report, repo_hint=repo_hint),
    }


@router.post("/compare", response_model=Comparison)
def compare_reports(request: Request, a: UUID = Query(...), b: UUID = Query(...)) -> Comparison:
    before = _get_report(request, a)
    after = _get_report(request, b)
    return compare(before, after)
