# =============================================================================
# core.schemas — single source of truth for every data shape in BlastRadius
# =============================================================================
# WHY centralize schemas here:
#   1. The parser produces ComposeModel; graph builder consumes it; API returns
#      it. One definition = no drift between what we validate, store, and send.
#   2. Pydantic v2 does double duty: runtime validation AND OpenAPI docs for
#      free (FastAPI reads these models to generate /docs).
#   3. Hard safety caps (RPS, VUs, duration) live in the schema validators, so
#      they are enforced even if someone bypasses the API and calls core
#      directly (e.g. the CLI). Defense in depth: Pydantic → runner → k6.
#
# Naming: every field name here is also the JSON key the frontend and CLI see.
# Renaming a field is a breaking API change — version it if you must.
# =============================================================================

from core.schemas.compose import (
    ComposeModel,
    ComposeService,
    DependsOnEntry,
    HealthcheckSpec,
    ResourceLimits,
)
from core.schemas.graph import (
    ArchitectureGraph,
    DependencyEdge,
    EdgeSource,
    GapFinding,
    GapSeverity,
    ImpactPath,
    PredictedImpact,
    ServiceKind,
    ServiceNode,
)
from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentState,
    ExperimentType,
    FaultConfig,
    FaultKind,
    LoadConfig,
    Phase,
    PreflightCheck,
    PreflightResult,
    SafetyLimits,
    SLO,
    # cap constants — re-exported so callers don't need to know where they live
    CAP_MAX_RPS,
    CAP_MAX_VUS,
    CAP_MAX_DURATION_S,
    CAP_MAX_TOTAL_REQUESTS,
    CAP_MAX_TIMEOUT_S,
)
from core.schemas.metrics import (
    Evidence,
    EvidenceKind,
    MetricBucket,
    MetricStatus,
    OptionalMetric,
    PhaseStats,
)
from core.schemas.report import (
    Comparison,
    Recommendation,
    RecommendationPriority,
    Report,
)

__all__ = [
    # compose
    "ComposeModel", "ComposeService", "DependsOnEntry",
    "HealthcheckSpec", "ResourceLimits",
    # graph
    "ArchitectureGraph", "DependencyEdge", "EdgeSource",
    "GapFinding", "GapSeverity", "ImpactPath",
    "PredictedImpact", "ServiceKind", "ServiceNode",
    # experiment
    "ExperimentCreate", "ExperimentState", "ExperimentType",
    "FaultConfig", "FaultKind", "LoadConfig", "Phase",
    "PreflightCheck", "PreflightResult", "SafetyLimits", "SLO",
    "CAP_MAX_RPS", "CAP_MAX_VUS", "CAP_MAX_DURATION_S",
    "CAP_MAX_TOTAL_REQUESTS", "CAP_MAX_TIMEOUT_S",
    # metrics
    "Evidence", "EvidenceKind", "MetricBucket",
    "MetricStatus", "OptionalMetric", "PhaseStats",
    # report
    "Comparison", "Recommendation", "RecommendationPriority", "Report",
]
