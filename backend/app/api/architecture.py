# =============================================================================
# backend.app.api.architecture — parse / get / impact routes (A1→A3→A5)
# =============================================================================
# The parse route is the pipeline in one call: safe YAML parse → build_graph
# (classify, edges, gaps) → persist. Any ComposeParseError becomes 422 with
# the parser's line/column message verbatim — the UI highlights the line.
#
# impact is a QUERY of the stored graph (pure core function), never a DB
# scan: load graph → predicted_impact → respond. include_network defaults to
# FALSE (spec: network edges are low-confidence; impact excludes them unless
# the user opts in — matching the graph module's default).
# =============================================================================

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core.graph import build_graph, predicted_impact
from core.parser import ComposeParseError, parse_compose
from core.schemas.graph import ArchitectureGraph, PredictedImpact

router = APIRouter(prefix="/api/architecture", tags=["architecture"])


class ParseRequest(BaseModel):
    """API shape for an uploaded compose file. (Deliberately NOT a core
    schema — core only knows ComposeModel; this is transport metadata.)"""

    content: str = Field(min_length=1, max_length=256 * 1024)
    filename: str | None = None
    name: str | None = None     # display name for the graph


class ImpactResponse(BaseModel):
    service: str
    impact: PredictedImpact


@router.post("/parse", response_model=ArchitectureGraph)
def parse_and_store(req: ParseRequest, request: Request) -> ArchitectureGraph:
    try:
        model = parse_compose(req.content, filename=req.filename)
    except ComposeParseError as e:
        # 422 (not 500): the USER's input is invalid, and the message
        # carries the line/column — FastAPI's 422 convention fits.
        raise HTTPException(status_code=422, detail=str(e)) from e
    graph = build_graph(model, name=req.name)
    request.app.state.br.store.save_graph(graph)
    return graph


@router.get("/{graph_id}", response_model=ArchitectureGraph)
def get_graph(graph_id: UUID, request: Request) -> ArchitectureGraph:
    from core.store import NotFound
    try:
        return request.app.state.br.store.get_graph(graph_id)
    except NotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/{graph_id}/impact/{service}", response_model=ImpactResponse)
def service_impact(
    graph_id: UUID,
    service: str,
    request: Request,
    include_network: bool = False,
) -> ImpactResponse:
    from core.store import NotFound
    try:
        graph = request.app.state.br.store.get_graph(graph_id)
    except NotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    if service not in {n.id for n in graph.nodes}:
        raise HTTPException(
            status_code=404,
            detail=f"service '{service}' not in graph (known: "
                   f"{', '.join(sorted(n.id for n in graph.nodes))})",
        )
    impact = predicted_impact(graph, service, include_network=include_network)
    return ImpactResponse(service=service, impact=impact)
