# =============================================================================
# core.graph.impact — predicted blast radius (reverse BFS)
# =============================================================================
# HOW it works:
#   Edge direction is source(dependent) → target(dependency). To answer
#   "if X fails, who suffers?", walk edges BACKWARD: anyone with an edge whose
#   TARGET is X is directly impacted; then continue from those, transitively.
#
# WHY BFS with a visited set, not recursion: compose graphs can have inferred
#   cycles (a→b via env, b→a via depends_on). Recursion would loop forever;
#   visited makes cycles harmless.
#
# WHY the result is called PREDICTED and never leaves that wording: this walks
#   CONFIG, not measurements. The schema has no field to mark it verified —
#   verified impact only ever comes from Evidence rows produced by an
#   experiment (schemas/graph.py DependencyEdge.verified_by invariant).
# =============================================================================

from __future__ import annotations

from collections import deque

from core.schemas.graph import (
    ArchitectureGraph,
    DependencyEdge,
    EdgeSource,
    ImpactPath,
    PredictedImpact,
)


def predicted_impact(
    graph: ArchitectureGraph,
    service: str,
    *,
    include_network: bool = False,
) -> PredictedImpact:
    """Blast radius for `service`, as ordered paths from the failed service
    to each impacted one.

    include_network: whether low-confidence inferred:network edges count.
    Default False — the blast radius should reflect the strongest evidence
    available; network co-membership is opt-in both in the UI legend and here.
    """
    allowed = {EdgeSource.DECLARED, EdgeSource.INFERRED_ENV}
    if include_network:
        allowed.add(EdgeSource.INFERRED_NETWORK)

    # Reverse adjacency: dependency → [(dependent, edge), ...]
    reverse: dict[str, list[tuple[str, DependencyEdge]]] = {}
    for e in graph.edges:
        if set(e.sources) & allowed:          # edge carries at least one allowed source
            reverse.setdefault(e.target, []).append((e.source, e))

    impacted: dict[str, ImpactPath] = {}
    sources_used: set[EdgeSource] = set()

    # BFS levels carry (current_node, path_from_failed_to_current,
    # reasons_accumulated_along_that_path) — reasons are the full story for
    # the chain, not just the last hop: "frontend via api" should show BOTH
    # 'depends_on: demo-api' and 'env REDIS_URL = …', or the reason for the
    # multi-hop prediction is half-told.
    queue: deque[tuple[str, list[str], list[str]]] = deque([(service, [], [])])
    visited: set[str] = {service}             # cycle guard; also excludes self

    while queue:
        node, path_so_far, reasons_so_far = queue.popleft()
        for dependent, edge in reverse.get(node, ()):
            if dependent in visited:
                continue
            visited.add(dependent)

            hop = path_so_far + [dependent]   # e.g. [demo-api, demo-frontend]
            hop_reasons = list(reasons_so_far)
            for r in edge.reasons:
                if r not in hop_reasons:
                    hop_reasons.append(r)
            impacted[dependent] = ImpactPath(
                impacted_service=dependent,
                via=hop,
                reasons=hop_reasons,
            )
            sources_used.update(set(edge.sources) & allowed)
            queue.append((dependent, hop, hop_reasons))

    # Deterministic order: BFS discovery order is already level-sorted; sort
    # within equal insertion by name for stable JSON (dict preserves
    # insertion order, BFS enqueues deterministically since reverse lists were
    # built in graph.edges order — sorted here to be explicit).
    ordered = sorted(
        impacted.values(),
        key=lambda p: (len(p.via), p.impacted_service),
    )

    return PredictedImpact(
        service=service,
        impacted=ordered,
        edge_sources_used=sorted(sources_used, key=lambda s: s.value),
    )
