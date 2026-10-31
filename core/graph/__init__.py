# =============================================================================
# core.graph — ComposeModel → ArchitectureGraph
# =============================================================================
# Public surface. Module responsibilities:
#   classify.py  service kind heuristics (database/cache/queue/frontend/api/worker)
#   edges.py     declared + env + network edge detection + merge
#   impact.py    reverse-BFS predicted blast radius
#   gaps.py      compose hygiene findings (missing healthcheck/limits/...)
#   builder.py   orchestrator: wires the above into one ArchitectureGraph
# =============================================================================

from core.graph.builder import build_graph
from core.graph.classify import classify_services, container_ports
from core.graph.edges import RawEdge, declared_edges, env_edges, merge_edges, network_edges
from core.graph.gaps import find_gaps
from core.graph.impact import predicted_impact

__all__ = [
    "build_graph",
    "classify_services",
    "container_ports",
    "RawEdge",
    "declared_edges",
    "env_edges",
    "merge_edges",
    "network_edges",
    "find_gaps",
    "predicted_impact",
]
