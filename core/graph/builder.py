# =============================================================================
# core.graph.builder — ComposeModel → ArchitectureGraph in one call
# =============================================================================
# WHY an explicit ordering of steps (and why env_edges runs FIRST, before
# classification):
#
#   1. env_edges + declared_edges   (no kinds needed — pure string matching)
#   2. classify_services(resolved_deps=env targets)
#        needs env edges so a worker with no depends_on but REDIS_HOST=...
#        still classifies as worker (the demo's teaching moment)
#   3. network_edges(kinds, already)  needs kinds for direction rules
#   4. merge_edges(all raw)           union per pair
#   5. find_gaps(kinds)               needs kinds
#
# This function is the ONLY place that knows the ordering. Callers (API
# handler, CLI, tests) just call build_graph(model, ...) — so a step can never
# be forgotten, which is exactly how "we classified but never merged" bugs
# happen when the pipeline lives in three call sites.
# =============================================================================

from __future__ import annotations

from uuid import UUID, uuid4

from core.graph.classify import classify_services
from core.graph.edges import declared_edges, env_edges, merge_edges, network_edges
from core.graph.gaps import find_gaps
from core.schemas.compose import ComposeModel
from core.schemas.graph import ArchitectureGraph, ServiceNode


def build_graph(
    model: ComposeModel,
    *,
    graph_id: UUID | None = None,
    name: str | None = None,
    include_network_edges: bool = True,
) -> ArchitectureGraph:
    """Run the full pipeline (see module header for step ordering rationale).

    include_network_edges: store inferred:network edges in the graph. They are
    STORED (the UI toggles visibility; impact excludes them by default) —
    flag exists so tests/CI can build a lean graph without low-confidence rows.

    name: display name; defaults to compose's top-level name or the uploaded
    filename — never fabricated as "untitled graph" when real metadata exists.
    """
    # 1 — detectors that need no kinds
    declared = declared_edges(model)
    env = env_edges(model)
    no_network = declared + env

    # 2 — classification uses env-resolved deps (worker teaching moment)
    resolved_deps: dict[str, set[str]] = {}
    for e in env:
        resolved_deps.setdefault(e.source, set()).add(e.target)
    kinds = classify_services(model, resolved_deps)

    # 3 — low-confidence network detector (direction needs kinds)
    raw = list(no_network)
    if include_network_edges:
        raw += network_edges(model, kinds, already=no_network)

    # 4 — merge per (source, target)
    edges = merge_edges(raw)

    # 5 — gaps (kinds ready)
    gaps = find_gaps(model, kinds)

    nodes = [
        ServiceNode(
            id=svc.name,
            kind=kinds[svc.name],
            kind_inferred=True,          # always True here; user override flips it later
            image=svc.image,
            ports=list(svc.ports),
            has_healthcheck=svc.healthcheck is not None,
            labels=dict(svc.labels),
            # parse-time snapshot for UI affordances; preflight re-checks LIVE
            fault_allowed=svc.labels.get("blastradius.fault-allowed", "").lower() == "true",
            networks=list(svc.networks),
            unanalysed_keys=list(svc.unanalysed_keys),
        )
        for svc in model.services.values()
    ]

    return ArchitectureGraph(
        id=graph_id or uuid4(),
        name=name or model.name or model.source_filename or "parsed compose",
        nodes=nodes,
        edges=edges,
        gaps=gaps,
        warnings=list(model.warnings),
    )
