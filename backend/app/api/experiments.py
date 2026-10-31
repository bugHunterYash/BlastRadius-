# =============================================================================
# backend.app.api.experiments — create / lifecycle / samples routes (B1, B4)
# =============================================================================
# Create flow decision (spec table says "PENDING or 422" — interpreted as):
#   - Pydantic validation failure        → 422 (FastAPI native, field paths)
#   - preflight returns failed checks    → 200 with state=PREFLIGHT_FAILED
#     and the FULL PreflightResult. Rationale: the UI's job is to render the
#     checklist and let the user fix every blocker in one pass; a bare 422
#     with no body would discard exactly the data the endpoint exists to
#     return. 422 stays reserved for "your request was malformed".
#
# start/abort: guarded state machine at the HTTP edge (409 on illegal
# transitions) BEFORE delegating to the injected controller seam — illegal
# requests never reach the controller, and when the seam is None we return
# 501 honestly (controller not wired on this build) instead of 200-lying.
#
# samples: the live chart's polling fallback (spec F2) and the report's
# phase analysis source — `from` is elapsed seconds, cursor-style.
# =============================================================================

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Request

from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentCreated,
    ExperimentState,
)
from core.schemas.metrics import MetricBucket
from core.store import NotFound

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


def _record(request: Request, experiment_id: UUID):
    store = request.app.state.br.store
    try:
        return store.get_experiment(experiment_id)
    except NotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


def _require_seam(name: str, fn):
    if fn is None:
        raise HTTPException(
            status_code=501,
            detail=f"{name} not wired on this build (controller requires Docker + k6)",
        )
    return fn


@router.post("", response_model=ExperimentCreated)
def create_experiment(exp: ExperimentCreate, request: Request) -> ExperimentCreated:
    state = request.app.state.br
    preflight = _require_seam("preflight", state.preflight)

    result = preflight(exp)
    experiment_id = uuid4()
    exp_state = ExperimentState.PENDING if result.passed else ExperimentState.PREFLIGHT_FAILED
    state.store.create_experiment(experiment_id, exp, result, state=exp_state)
    return ExperimentCreated(id=experiment_id, state=exp_state, preflight=result)


@router.get("", response_model=list[dict])
def list_experiments(request: Request) -> list[dict]:
    store = request.app.state.br.store
    return [
        {
            "id": r.id,
            "name": r.name,
            "type": r.type,
            "state": r.state,
            "created_at": r.created_at,
            "compared_to": r.compared_to,
        }
        for r in store.list_experiments()
    ]


@router.get("/{experiment_id}")
def get_experiment(experiment_id: UUID, request: Request) -> dict:
    r = _record(request, experiment_id)
    return {
        "id": r.id,
        "name": r.name,
        "type": r.type,
        "state": r.state,
        "config": r.config,
        "preflight": r.preflight,
        "compared_to": r.compared_to,
        "created_at": r.created_at,
        "started_at": r.started_at,
        "ended_at": r.ended_at,
        "stop_reason": r.stop_reason,
    }


@router.post("/{experiment_id}/start", response_model=ExperimentCreated)
def start_experiment(experiment_id: UUID, request: Request) -> ExperimentCreated:
    state = request.app.state.br
    r = _record(request, experiment_id)
    if r.state == ExperimentState.PREFLIGHT_FAILED:
        raise HTTPException(
            status_code=409,
            detail="preflight failed — fix the listed blockers and create a new experiment",
        )
    if r.state != ExperimentState.PENDING:
        raise HTTPException(
            status_code=409,
            detail=f"cannot start: experiment is {r.state.value}",
        )
    start = _require_seam("controller start", state.start_experiment)
    start(experiment_id)
    # Re-read: the controller seam may have transitioned it (tests do;
    # production does asynchronously — re-read returns whatever is true NOW,
    # no optimistic state invented by the API).
    r = state.store.get_experiment(experiment_id)
    return ExperimentCreated(id=r.id, state=r.state, preflight=r.preflight)


@router.post("/{experiment_id}/abort", response_model=ExperimentCreated)
def abort_experiment(experiment_id: UUID, request: Request) -> ExperimentCreated:
    state = request.app.state.br
    r = _record(request, experiment_id)
    if r.state not in (ExperimentState.RUNNING, ExperimentState.PENDING):
        raise HTTPException(
            status_code=409,
            detail=f"cannot abort: experiment is {r.state.value}",
        )
    abort = _require_seam("controller abort", state.abort_experiment)
    abort(experiment_id)
    r = state.store.get_experiment(experiment_id)
    return ExperimentCreated(id=r.id, state=r.state, preflight=r.preflight)


@router.get("/{experiment_id}/samples", response_model=list[MetricBucket])
def get_samples(
    experiment_id: UUID,
    request: Request,
    from_: float | None = Query(default=None, alias="from", ge=0),
) -> list[MetricBucket]:
    _record(request, experiment_id)   # 404 before querying buckets
    return request.app.state.br.store.get_buckets(experiment_id, from_elapsed=from_)


@router.post("/{experiment_id}/mark-phase")
def mark_phase(
    experiment_id: UUID,
    request: Request,
    name: str = Query(min_length=1, max_length=32),
    elapsed_s: float = Query(ge=0),
) -> dict:
    _record(request, experiment_id)
    request.app.state.br.store.mark_phase(experiment_id, name, elapsed_s)
    return {"experiment_id": experiment_id, "phase": name, "elapsed_s": elapsed_s}
