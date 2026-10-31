# =============================================================================
# core.analysis.percentiles — exact percentiles from raw durations
# =============================================================================
# WHY recompute from raw samples instead of averaging bucket p95s:
#   percentiles are not linear. The mean of per-second p95s is NOT the p95
#   of the phase — it over-weights quiet seconds and under-weights bursts.
#   PhaseStats percentiles therefore always come from sorting the phase's
#   raw durations (this module). Bucket-level p95s exist only for the LIVE
#   chart, where per-second approximation is acceptable mid-run.
#
# WHY nearest-rank (not linear i nterpolation):
#   The reported p95 should be a duration we ACTUALLY observed — an operator
#   can then find that request in the raw samples ("p95 was 412ms" means some
#   real request took 412ms). Interpolation invents values between samples,
#   which is statistically fine but forensically useless. Definition:
#       idx = ceil(p/100 * n) - 1, clamped to [0, n-1]  (1-based rank p%)
#   p95 of 20 sorted samples → rank ceil(19) = 19 → the 19th value.
# =============================================================================

from __future__ import annotations

import math
from collections.abc import Sequence

from core.schemas.metrics import MetricStatus, OptionalMetric, Percentiles

# Below this many samples, p95... p99 is noise — mirrors MetricBucket.p95_ms docs.
_P99_MIN_SAMPLES = 100


def p99_optional(pct: Percentiles) -> OptionalMetric:
    """Map Percentiles → the schema's honest OptionalMetric. Single place
    implementing the 'p99 below 100 samples is LOW_SAMPLE' rule so bucket
    construction, phase stats and any future consumer can't drift apart."""
    if pct.p99_ms is None:
        return OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE, reason="no samples")
    if not pct.p99_trusted:
        return OptionalMetric(
            value=pct.p99_ms,
            status=MetricStatus.LOW_SAMPLE,
            reason=f"only {pct.n} samples (<100)",
        )
    return OptionalMetric(value=pct.p99_ms, status=MetricStatus.OK)


def nearest_rank(sorted_durations: Sequence[float], p: float) -> float | None:
    """p in (0, 100]. `sorted_durations` MUST be sorted ascending (caller's
    responsibility — sorting once and taking several percentiles is the
    point). Returns None for empty input."""
    n = len(sorted_durations)
    if n == 0:
        return None
    rank = math.ceil(p / 100 * n)
    idx = min(max(rank - 1, 0), n - 1)
    return sorted_durations[idx]


def compute_percentiles(durations_ms: Sequence[float]) -> Percentiles:
    """Sort once, extract p50/p95/p99/max in one pass over the sorted list.
    Empty input → Percentiles.empty() (caller decides whether empty is a
    failure — phase stats vs. an idle recovery window have different
    meanings, so this function refuses to decide for them)."""
    if not durations_ms:
        return Percentiles.empty()
    ordered = sorted(durations_ms)
    return Percentiles(
        p50_ms=nearest_rank(ordered, 50),
        p95_ms=nearest_rank(ordered, 95),
        p99_ms=nearest_rank(ordered, 99),
        max_ms=ordered[-1],
        n=len(ordered),
        p99_trusted=len(ordered) >= _P99_MIN_SAMPLES,
    )
