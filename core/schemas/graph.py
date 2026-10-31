# =============================================================================
# core.schemas.graph — the dependency graph + confidence model
# =============================================================================
# HOW it fits in the pipeline:
#   ComposeModel ──classify/edges──▶ ArchitectureGraph ──▶ stored JSONB
#                                          │
#                              experiments verify edges
#                                          ▼
#                                  verified edge sources
#
# WHY the four-level confidence model is baked into the types (not just docs):
#   EdgeSource is an enum, and `verified` edges REQUIRE a non-empty
#   `verified_by` experiment-id list. The type system stops a developer from
#   ever writing "this edge is verified" without a measurement to point at.
#   This is the honesty principle enforced in code, not in a style guide.
#
# Direction convention (confusing at first — get it wrong once and every BFS
# is backwards):
#   edge.source = the DEPENDENT  (demo-api)
#   edge.target = the DEPENDENCY (demo-redis)
#   "demo-api depends on demo-redis" ⇒ source=demo-api, target=demo-redis
#   Blast radius walks REVERSE edges: who depends ON the failed service?
# =============================================================================

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class ServiceKind(str, Enum):
    """Coarse classification of a service. ALWAYS heuristic when derived from
    image/ports — the `kind_inferred` flag on ServiceNode records that."""

    FRONTEND = "frontend"
    API = "api"
    DATABASE = "database"
    CACHE = "cache"
    QUEUE = "queue"
    WORKER = "worker"
    UNKNOWN = "unknown"


class EdgeSource(str, Enum):
    """Confidence level(s) for an edge. An edge can carry MULTIPLE sources
    (e.g. both declared and inferred:env) — we union them rather than picking
    one, because more evidence is strictly better."""

    DECLARED = "declared"                  # depends_on / links — high confidence
    INFERRED_ENV = "inferred:env"          # env var host match — medium
    INFERRED_NETWORK = "inferred:network"  # shared non-default network — low
    VERIFIED = "verified"                  # measured in an experiment — highest


class GapSeverity(str, Enum):
    """Severity for compose gap findings (missing healthcheck, etc.)."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ServiceNode(BaseModel):
    """One node in the architecture graph. Maps 1:1 to a compose service."""

    id: str  # service name; stable across re-parses of the same file
    kind: ServiceKind
    # True when `kind` came from heuristics (image/ports) rather than a user
    # override in the inspector. UI shows an "inferred" badge when True.
    kind_inferred: bool = True
    image: str | None = None
    ports: list[str] = Field(default_factory=list)
    # True if a healthcheck block exists — gap analysis reads this.
    has_healthcheck: bool = False
    labels: dict[str, str] = Field(default_factory=dict)
    # True only when label blastradius.fault-allowed=true is present.
    # Preflight re-checks this live against Docker; this is the parse-time
    # snapshot for enabling/disabling the "run experiment" button.
    fault_allowed: bool = False
    networks: list[str] = Field(default_factory=list)
    # Keys we didn't analyse for this service — surfaced in the inspector.
    unanalysed_keys: list[str] = Field(default_factory=list)


class DependencyEdge(BaseModel):
    """One directed edge: source (dependent) → target (dependency)."""

    source: str
    target: str
    # Union of all evidence supporting this edge. Never empty.
    sources: list[EdgeSource] = Field(min_length=1)
    # Human-readable reasons, one per source, e.g.
    #   "depends_on: demo-redis"
    #   "env REDIS_URL = redis://demo-redis:6379"  (passwords redacted)
    # The inspector shows these verbatim when the user asks "why does X
    # affect Y?" — they are the audit trail for inferred edges.
    reasons: list[str] = Field(default_factory=list)
    # Experiment IDs that VERIFIED this edge (only populated for VERIFIED
    # sources). Each links to a report so the user can see the evidence.
    verified_by: list[UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def _verified_needs_evidence(self) -> DependencyEdge:
        """WHY: a VERIFIED source with no experiment ID is a lie — it claims
        measurement without pointing at one. This invariant is cheaper to
        enforce here than to remember in every writer."""
        if EdgeSource.VERIFIED in self.sources and not self.verified_by:
            raise ValueError(
                "edge marked 'verified' must carry at least one experiment id "
                "in verified_by"
            )
        return self


class GapFinding(BaseModel):
    """One compose hygiene gap (missing healthcheck, single-DB SPOF, ...).
    Deterministic — produced by a fixed rule table, never by an LLM."""

    rule_id: str          # e.g. "missing-healthcheck"
    severity: GapSeverity
    service: str | None   # None for whole-file findings
    detail: str           # one human sentence
    # Dotted path into the compose file (e.g. "services.demo-api.healthcheck")
    # so the YAML editor can deep-link / highlight the missing block.
    compose_path: str | None = None


class ImpactPath(BaseModel):
    """One predicted impact chain, for the inspector's blast-radius view.

        demo-frontend ← demo-api ← demo-redis   (redis failed)

    WHY store the full path, not just the endpoint: the user needs to see
    *why* frontend was predicted affected ("via demo-api"), otherwise the
    prediction looks like guesswork."""

    impacted_service: str
    # Ordered chain from the failed service to the impacted one.
    via: list[str] = Field(min_length=1)
    # Reason strings from the edges along the path.
    reasons: list[str] = Field(default_factory=list)


class PredictedImpact(BaseModel):
    """Result of reverse-BFS from a selected service. ALWAYS labeled
    "predicted, not verified" in the UI — verified impact only ever comes
    from experiment evidence, never from this."""

    service: str
    impacted: list[ImpactPath] = Field(default_factory=list)
    # Confidence levels that contributed — lets the UI say
    # "2 declared, 1 inferred" next to the list.
    edge_sources_used: list[EdgeSource] = Field(default_factory=list)


class ArchitectureGraph(BaseModel):
    """The full stored graph. This JSONB row is what
    architecture_graphs.graph holds and what GET /api/architecture/{id}
    returns."""

    id: UUID
    name: str
    nodes: list[ServiceNode]
    edges: list[DependencyEdge]
    gaps: list[GapFinding] = Field(default_factory=list)
    # Parser warnings that aren't tied to one service.
    warnings: list[str] = Field(default_factory=list)
    # The uncertainty banner text — stored, not hardcoded in the frontend, so
    # CLI --json output carries the same disclaimer as the UI.
    uncertainty_note: str = (
        "Compose files describe configuration, not runtime behaviour. "
        "Calls via external URLs, service discovery, or hard-coded hosts may "
        "not appear here. Edges marked *inferred* are heuristics. Only "
        "*verified* edges are backed by measurements."
    )
