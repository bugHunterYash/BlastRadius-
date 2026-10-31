# =============================================================================
# core.report — finalization of the stored Report (recommendations, prompt, score)
# =============================================================================
# Deterministic by construction: every export is a pure function of stored
# data. The controller calls finalize_report() once at experiment end; the
# stored JSON is thereafter immutable (regeneration only happens for the
# before/after re-score path, which is also deterministic).
# =============================================================================

from core.report.builder import finalize_report, recommendations_for
from core.report.fix_prompt import generate_fix_prompt
from core.report.score import compute_score

__all__ = [
    "finalize_report",
    "recommendations_for",
    "generate_fix_prompt",
    "compute_score",
]
