# =============================================================================
# core.analysis.slo — SLO evaluation + capacity breaking point
# =============================================================================
# TWO concepts that are easy to conflate, kept strictly separate:
#   SLO  — "healthy" (user's definition, from config). Breaching an SLO is
#          the MEASUREMENT — the run continues so we can see HOW it degrades.
#   Safety limit — "target is hurting" (fixed). Breaching it ABORTS the run
#          (k6 abortOnFail + Python watchdog).
# This module only implements the first. It never stops anything.
#
# WHY the breaking point is a RANGE, not a number:
#   "The app breaks at ~2x" is honest; "the app breaks at exactly 2.4x" is
#   false precision from a discrete ladder. highest_pass < multiplier ≤
#   first_breach is the interval we actually measured. The report renders
#   the range; a single number is derived only for the summary card
#   ("highest passing step").
# =============================================================================

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from core.schemas.experiment import SLO
from core.schemas.metrics import PhaseStats

BreachKind = str  # "p95" | "error_rate" | "throughput" — matches PhaseStats.slo_breaches Literal


def evaluate_slo(
    *,
    p95_ms: float | None,
    error_rate: float,
    achieved_rps: float,
    target_rps: float,
    slo: SLO,
) -> list[BreachKind]:
    """One step/phase vs the SLO. Returns the breached dimensions ([] =
    healthy). None p95 (no samples) counts as NOT a p95 breach — but such a
    phase will almost always breach throughput anyway (0 requests vs
    min_rps_ratio), and if target_rps is 0 it can't. Callers that need to
    distinguish 'no data' from 'healthy' must check requests separately —
    honesty rule: absence of data is never evidence of health."""
    breaches: list[BreachKind] = []
    if p95_ms is not None and p95_ms > slo.p95_ms:
        breaches.append("p95")
    if error_rate > slo.max_error_rate:
        breaches.append("error_rate")
    if target_rps > 0 and achieved_rps < slo.min_rps_ratio * target_rps:
        breaches.append("throughput")
    return breaches


def annotate_slo_breaches(
    stats: Sequence[PhaseStats],
    slo: SLO,
) -> list[PhaseStats]:
    """Return copies of `stats` with slo_breaches re-evaluated. Kept separate
    from phase_stats() so a stored PhaseStats row can be RE-scored against a
    different SLO without re-reading raw samples (report what-ifs, and the
    before/after comparison uses one SLO across both runs).

    CANNOT re-check the throughput dimension: PhaseStats stores achieved rps
    but not the configured target_rps. A breach already recorded at creation
    time is PRESERVED (re-eval must never un-record a breach); new p95 /
    error_rate breaches are added."""
    return [s.model_copy(update={"slo_breaches": _recompute(s, slo)}) for s in stats]


def _recompute(s: PhaseStats, slo: SLO) -> list[BreachKind]:
    breaches = evaluate_slo(
        p95_ms=s.p95_ms,
        error_rate=s.error_rate,
        achieved_rps=s.rps,
        target_rps=0.0,  # unknown here — skip throughput on re-eval
        slo=slo,
    )
    for b in s.slo_breaches:
        if b not in breaches:
            breaches.append(b)
    return breaches


@dataclass(frozen=True)
class BreakingPoint:
    """Capacity-run verdict. Range semantics in module header.

    highest_pass: max multiplier among steps with NO breaches (None if even
    the first step breached — the app couldn't handle the baseline!).
    first_breach: min multiplier among breached steps (None = no breach up
    to the max tested).
    breached_steps: every breached step with its failed dimensions — the
    SSE `breach` event and the report table read this, not just the summary.
    """

    highest_pass: float | None
    first_breach: float | None
    breached_steps: list[tuple[float, list[BreachKind]]] = field(default_factory=list)

    @property
    def no_breach_up_to(self) -> float | None:
        """When nothing breached: the max tested multiplier (the honest
        statement is 'no breach up to X', never 'X is safe')."""
        return None if self.first_breach is not None else self.highest_pass


def breaking_point(stats: Sequence[PhaseStats]) -> BreakingPoint:
    """Derive the breaking-point range from per-step stats (each carrying
    slo_breaches computed at creation). Input must be capacity-run steps —
    one PhaseStats per load_multiplier, sorted ascending by multiplier is
    NOT required (we sort internally)."""
    steps = sorted(stats, key=lambda s: s.load_multiplier)
    highest_pass: float | None = None
    first_breach: float | None = None
    breached: list[tuple[float, list[BreachKind]]] = []

    for s in steps:
        if s.slo_breaches:
            breached.append((s.load_multiplier, list(s.slo_breaches)))
            if first_breach is None:
                first_breach = s.load_multiplier
        else:
            highest_pass = s.load_multiplier

    # highest_pass must be BELOW first_breach to make the range meaningful:
    # if a lower step breached and a higher one didn't (non-monotonic —
    # cache warm-up, noise), the honest output keeps both facts but the
    # range becomes "not monotonic" via first_breach > highest_pass check
    # by the report layer. Here we just record what happened.
    return BreakingPoint(
        highest_pass=highest_pass,
        first_breach=first_breach,
        breached_steps=breached,
    )
