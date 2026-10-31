# =============================================================================
# core.analysis — pure measurement analysis (D1–D4)
# =============================================================================
# Everything here is a pure function over buckets + raw samples: no I/O, no
# clocks, no Docker. The controller feeds windows; the report renders results.
# D5 (bottleneck classification, P2) lands later — it needs docker-stats
# series that the P2-lite sampler will provide.
# =============================================================================

from core.analysis.compare import compare
from core.analysis.evidence import build_evidence, verified_services
from core.analysis.percentiles import compute_percentiles, nearest_rank
from core.analysis.phases import phase_stats
from core.analysis.recovery import RecoveryResult, measure_recovery
from core.analysis.slo import BreakingPoint, breaking_point, evaluate_slo

__all__ = [
    "compare",
    "build_evidence",
    "verified_services",
    "compute_percentiles",
    "nearest_rank",
    "phase_stats",
    "RecoveryResult",
    "measure_recovery",
    "BreakingPoint",
    "breaking_point",
    "evaluate_slo",
]
