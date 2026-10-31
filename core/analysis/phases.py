# =============================================================================
# core.analysis.phases — group buckets into PhaseStats
# =============================================================================
# WHY grouping is parameterised (phase vs multiplier):
#   FAULT runs vary the FAULT, not the load: one constant load, three phases
#   (baseline/fault/recovery) → group by `phase`.
#   CAPACITY runs vary the LOAD, no fault: N load steps → group by
#   `load_multiplier` (each step is one PhaseStats with phase=load_step).
#   Same aggregation code, two questions — one function, `group_by` selects.
#
# WHY ramp seconds can be trimmed (`trim_ramp_s`):
#   During a k6 ramp stage the arrival rate is BETWEEN steps — including
#   those seconds in the higher step's stats mixes two load levels and
#   muddies the breach decision ("did 2x breach, or did the 1x→2x ramp
#   drag it over?"). The controller tags ramp buckets with the multiplier
#   being ramped TO; analysis trims the first `ramp_s` seconds of each
#   multiplier window so stats reflect STEADY STATE at that level.
#   Trim applies to BOTH bucket sums and raw-sample windows — percentiles
#   and error rates must describe the same time range, or the numbers
#   can't be compared with each other.
#
# WHY percentiles come from raw durations (see percentiles.py): averaging
# bucket p95s is mathematically wrong. This module filters the raw list to
# each group's [start, end) window and calls compute_percentiles.
# =============================================================================

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta

from core.analysis.percentiles import compute_percentiles, p99_optional
from core.analysis.slo import evaluate_slo
from core.schemas.experiment import SLO
from core.schemas.metrics import MetricBucket, PhaseStats, RawSample


def phase_stats(
    buckets: Sequence[MetricBucket],
    raw_samples: Sequence[RawSample],
    slo: SLO,
    *,
    group_by: str = "phase",          # "phase" | "multiplier"
    target_rps_at: dict[float, float] | None = None,  # multiplier → configured target
    trim_ramp_s: int = 0,
) -> list[PhaseStats]:
    """Aggregate buckets (+ matching raw samples) into PhaseStats.

    target_rps_at: capacity runs must pass the CONFIGURED target per
    multiplier so the throughput SLO can be checked (achieved vs asked).
    Missing entry → throughput dimension skipped for that multiplier
    (honesty: can't evaluate what wasn't provided; never assume target ==
    achieved, which would make the check tautological).

    Returns groups sorted by (start time, multiplier).
    """
    groups: dict[tuple[str, float], list[MetricBucket]] = {}
    for b in buckets:
        key = (b.phase, b.load_multiplier) if group_by == "multiplier" else (b.phase, 1.0)
        # NOTE for group_by="phase": multiplier is folded to 1.0 as a grouping
        # placeholder; the PhaseStats row keeps the mean multiplier of its
        # buckets below (fault runs have a single real multiplier anyway).
        groups.setdefault(key, []).append(b)

    out: list[PhaseStats] = []
    for (phase, mult_key), group in groups.items():
        group.sort(key=lambda b: b.elapsed_s)
        start_elapsed = group[0].elapsed_s
        end_elapsed = group[-1].elapsed_s + 1.0  # bucket covers [t, t+1)
        if trim_ramp_s > 0 and group_by == "multiplier":
            start_elapsed += trim_ramp_s
            group = [b for b in group if b.elapsed_s >= start_elapsed]
            if not group:
                # Whole window was ramp — no steady state at this step.
                continue

        window_samples = [
            s for s in raw_samples
            if start_elapsed <= s.t < end_elapsed
        ]

        requests = sum(b.requests for b in group)
        failures = sum(b.failures for b in group)
        successes = sum(b.successes for b in group)
        window_s = end_elapsed - start_elapsed
        achieved_rps = requests / window_s if window_s > 0 else 0.0
        error_rate = failures / requests if requests > 0 else 0.0

        pct = compute_percentiles([s.duration_ms for s in window_samples])
        p99 = p99_optional(pct)

        multiplier = (
            mult_key
            if group_by == "multiplier"
            else (sum(b.load_multiplier for b in group) / len(group) if group else 1.0)
        )
        target = (target_rps_at or {}).get(multiplier)

        breaches = evaluate_slo(
            p95_ms=pct.p95_ms,
            error_rate=error_rate,
            achieved_rps=achieved_rps,
            target_rps=target if target is not None else 0.0,
            slo=slo,
        )

        out.append(
            PhaseStats(
                phase=phase,
                load_multiplier=multiplier,
                start=_elapsed_to_datetime(group, start_elapsed),
                end=_elapsed_to_datetime(group, end_elapsed),
                requests=requests,
                error_rate=error_rate,
                rps=achieved_rps,
                p50_ms=pct.p50_ms,
                p95_ms=pct.p95_ms,
                p99_ms=p99,
                max_ms=pct.max_ms,
                slo_breaches=breaches,  # type: ignore[arg-type]
            )
        )

    out.sort(key=lambda s: (s.start, s.load_multiplier))
    return out


def _elapsed_to_datetime(buckets: Sequence[MetricBucket], elapsed: float) -> datetime:
    """Convert elapsed-seconds back to wall time using the bucket anchors:
    bucket.t corresponds to bucket.elapsed_s, so t0 = bucket.t - elapsed.
    Uses the FIRST bucket's anchor (same clock for the whole experiment).
    Raises ValueError on empty input — an empty group is a caller bug."""
    if not buckets:
        raise ValueError("cannot anchor elapsed time: no buckets in group")
    anchor = buckets[0]
    t0 = anchor.t - timedelta(seconds=anchor.elapsed_s)
    return t0 + timedelta(seconds=elapsed)
