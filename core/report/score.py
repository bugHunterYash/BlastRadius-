# =============================================================================
# core.report.score — deterministic resilience score (0–100)
# =============================================================================
# Formula is FIXED here (spec E3) — no tuning knobs, no per-run randomness.
# Deductions map to what we could MEASURE; the unknown-bottleneck penalty is
# an honesty tax: when we couldn't tell you WHY, the score admits it.
#
# Why the score is never shown alone (schema: OptionalMetric, always next to
# evidence): a number without its inputs is exactly the kind of ungrounded
# claim this tool exists to avoid. The UI renders "Score 62/100" collapsed
# next to the evidence table that produced it.
#
# Two params are Report-unavailable and passed explicitly:
#   high_gap_count — compose gap findings live on the GRAPH, not the report.
#   retest_passed  — before/after outcome of a LATER run; the score of the
#                    ORIGINAL report can't know it. The re-test flow re-scores
#                    with retest_passed=True (+10) for the "after" view.
# =============================================================================

from __future__ import annotations

from core.schemas.experiment import ExperimentType
from core.schemas.report import Report

# Per-deduction caps (cap the SUBTOTAL, not each instance).
_IMPACT_PENALTY_PER_SERVICE = 12
_IMPACT_PENALTY_CAP = 24
_GAP_PENALTY_PER_GAP = 8
_GAP_PENALTY_CAP = 16
_RECOVERY_SLOW_S = 10.0
_BREAKING_POINT_FLOOR = 2.0    # breach at <2× baseline = fragile stack


def compute_score(
    report: Report,
    *,
    high_gap_count: int = 0,
    retest_passed: bool | None = None,
) -> int:
    """Clamped 0–100. Pure function of the report + the two explicit extras."""
    score = 100.0

    is_fault_run = report.config.type in (
        ExperimentType.FAULT,
        ExperimentType.FAULT_UNDER_LOAD,
    )

    # -15: any SLO breach in a fault run (the fault broke SLOs — the point of
    # measuring, but it IS a resilience failure).
    if is_fault_run and any(p.slo_breaches for p in report.phases):
        score -= 15

    # -10: slow or failed recovery.
    if report.recovered is not None:
        if report.recovered is False or (
            report.recovery_time_s is not None and report.recovery_time_s > _RECOVERY_SLOW_S
        ):
            score -= 10

    # -12 per verified impacted service, capped at 24 (two services max bite).
    if report.affected_services:
        score -= min(
            _IMPACT_PENALTY_CAP,
            _IMPACT_PENALTY_PER_SERVICE * len(report.affected_services),
        )

    # -8 per high gap finding, capped at 16.
    if high_gap_count > 0:
        score -= min(_GAP_PENALTY_CAP, _GAP_PENALTY_PER_GAP * high_gap_count)

    # -10: breaking point below 2× (a stack that fails at its first step has
    # no headroom — 1× already breached means first_breach == 1.0).
    if (
        report.first_breach_multiplier is not None
        and report.first_breach_multiplier < _BREAKING_POINT_FLOOR
    ):
        score -= 10

    # -8: honesty tax — we could not classify the bottleneck.
    if report.bottleneck == "unknown":
        score -= 8

    # +10: a later controlled re-test passed all SLOs.
    if retest_passed is True:
        score += 10

    return int(max(0.0, min(100.0, round(score))))
