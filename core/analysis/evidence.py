# =============================================================================
# core.analysis.evidence — measured proof of impact (not prediction)
# =============================================================================
# The graph PREDICTS ("killing redis should hurt api"). This module VERIFIES
# against measurements: for each NON-faulted service, did its endpoints
# actually degrade during the fault window vs the baseline window?
#
# Rules implemented (P0 — deterministic, no ML):
#   1. request_errors — endpoint error rate rose ≥ 5 percentage points AND
#      exceeds baseline_mean + 3σ (per-second baseline bucket rates). The
#      3σ arm filters noise; the 5pp arm filters 'rose from 0.0% to 0.3%'
#      trivia. BOTH must hold.
#   2. latency_regression — service p95 rose ≥ 50% relative AND ≥ 50ms
#      absolute. Both arms again: 20ms→31ms is +55% but noise; 200ms→260ms
#      is +30% but nobody cares — the double gate is the point.
#   3. health_check — health probe flipped to unhealthy during the fault
#      window (and was not already unhealthy in baseline).
#   4. log_signature — P2, intentionally unimplemented (enum reserved).
#
# WHY the caller splits windows (baseline_samples vs fault_samples): the
# controller owns phase timestamps (baseline/fault/recovery markers);
# evidence stays pure and clock-agnostic. Same for health: caller passes the
# bucket lists; this module scans their health dicts.
#
# WHY baseline_value/observed_value/sample_count are mandatory on Evidence:
#   audit trail — "verified" without numbers is just "assumed" in a tuxedo.
# =============================================================================

from __future__ import annotations

import statistics
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta

from core.analysis.percentiles import compute_percentiles
from core.schemas.metrics import Evidence, EvidenceKind, MetricBucket, RawSample

# Rule thresholds (module constants so the demo report and tests quote the
# same numbers the code uses — no magic literals scattered in functions).
ERROR_RATE_RISE_PP = 0.05        # absolute rise, 5 percentage points
ERROR_SIGMA_MULT = 3.0           # baseline noise gate
LATENCY_RELATIVE_RISE = 0.50     # p95 +50% ...
LATENCY_ABSOLUTE_RISE_MS = 50.0  # ... AND +50ms


def build_evidence(
    *,
    baseline_samples: Sequence[RawSample],
    fault_samples: Sequence[RawSample],
    baseline_buckets: Sequence[MetricBucket],
    fault_buckets: Sequence[MetricBucket],
    service_endpoints: Mapping[str, Sequence[str]],
    window_start: datetime,
    window_end: datetime,
) -> list[Evidence]:
    """Evaluate all rules for every service in `service_endpoints`.
    Returns evidence rows (empty list = nothing observed — the report then
    says 'predicted, not observed' for graph-predicted services)."""
    evidence: list[Evidence] = []
    for service, endpoints in service_endpoints.items():
        evidence.extend(
            _rule_request_errors(service, endpoints, baseline_samples, fault_samples,
                                 window_start, window_end)
        )
        evidence.extend(
            _rule_latency(service, endpoints, baseline_samples, fault_samples,
                          window_start, window_end)
        )
        evidence.extend(
            _rule_health(service, baseline_buckets, fault_buckets, window_start, window_end)
        )
    return evidence


def verified_services(evidence: Sequence[Evidence]) -> set[str]:
    """Services with ≥1 evidence row — the 'verified impact' set that the
    report contrasts with the graph's predicted set."""
    return {e.service for e in evidence}


# --- rule 1: request errors ---------------------------------------------------

def _rule_request_errors(
    service: str,
    endpoints: Sequence[str],
    baseline: Sequence[RawSample],
    fault: Sequence[RawSample],
    window_start: datetime,
    window_end: datetime,
) -> list[Evidence]:
    rows: list[Evidence] = []
    for ep in endpoints:
        base_ep = [s for s in baseline if s.endpoint == ep]
        fault_ep = [s for s in fault if s.endpoint == ep]
        if not base_ep or not fault_ep:
            # No baseline traffic for this endpoint → no comparison possible.
            # (Honesty: we do not claim stability from absence of data.)
            continue

        base_rate = _error_rate(base_ep)
        fault_rate = _error_rate(fault_ep)

        # 3σ from per-second baseline error rates (bucket by floor(t)).
        per_second: dict[int, list[RawSample]] = {}
        for s in base_ep:
            per_second.setdefault(int(s.t), []).append(s)
        rates = [_error_rate(v) for v in per_second.values()]
        mean = statistics.fmean(rates) if rates else 0.0
        sigma = statistics.pstdev(rates) if len(rates) > 1 else 0.0
        noise_bound = mean + ERROR_SIGMA_MULT * sigma

        rise = fault_rate - base_rate
        if rise >= ERROR_RATE_RISE_PP and fault_rate > noise_bound:
            rows.append(
                Evidence(
                    service=service,
                    kind=EvidenceKind.REQUEST_ERRORS,
                    metric=f"error_rate:{ep}",
                    baseline_value=round(base_rate, 4),
                    observed_value=round(fault_rate, 4),
                    window_start=window_start,
                    window_end=window_end,
                    sample_count=len(fault_ep),
                    detail=(
                        f"error rate {base_rate * 100:.1f}% → {fault_rate * 100:.1f}% "
                        f"on {ep} (baseline noise bound {noise_bound * 100:.1f}%)"
                    ),
                    extra={"noise_bound": round(noise_bound, 4), "rise_pp": round(rise, 4)},
                )
            )
    return rows


def _error_rate(samples: Sequence[RawSample]) -> float:
    if not samples:
        return 0.0
    return sum(1 for s in samples if _is_failure(s)) / len(samples)


def _is_failure(s: RawSample) -> bool:
    return bool(s.error) or s.status == 0 or s.status >= 400


# --- rule 2: latency regression ----------------------------------------------

def _rule_latency(
    service: str,
    endpoints: Sequence[str],
    baseline: Sequence[RawSample],
    fault: Sequence[RawSample],
    window_start: datetime,
    window_end: datetime,
) -> list[Evidence]:
    base_d = [s.duration_ms for s in baseline if s.endpoint in endpoints and not _is_failure(s)]
    fault_d = [s.duration_ms for s in fault if s.endpoint in endpoints and not _is_failure(s)]
    if len(base_d) < 2 or len(fault_d) < 2:
        return []  # need real distributions on both sides

    base_p95 = compute_percentiles(base_d).p95_ms
    fault_p95 = compute_percentiles(fault_d).p95_ms
    if base_p95 is None or fault_p95 is None:
        return []

    relative = (fault_p95 - base_p95) / base_p95 if base_p95 > 0 else float("inf")
    absolute = fault_p95 - base_p95
    if relative >= LATENCY_RELATIVE_RISE and absolute >= LATENCY_ABSOLUTE_RISE_MS:
        return [
            Evidence(
                service=service,
                kind=EvidenceKind.LATENCY_REGRESSION,
                metric="p95_ms",
                baseline_value=round(base_p95, 1),
                observed_value=round(fault_p95, 1),
                window_start=window_start,
                window_end=window_end,
                sample_count=len(fault_d),
                detail=(
                    f"p95 latency {base_p95:.0f}ms → {fault_p95:.0f}ms "
                    f"(+{relative * 100:.0f}%)"
                ),
                extra={"relative_rise": round(relative, 3), "absolute_rise_ms": round(absolute, 1)},
            )
        ]
    return []


# --- rule 3: health flip ------------------------------------------------------

def _rule_health(
    service: str,
    baseline_buckets: Sequence[MetricBucket],
    fault_buckets: Sequence[MetricBucket],
    window_start: datetime,
    window_end: datetime,
) -> list[Evidence]:
    base_unhealthy = any(b.health.get(service) == "unhealthy" for b in baseline_buckets)
    if base_unhealthy:
        return []  # was already down before the fault — not caused by it
    flipped = [b for b in fault_buckets if b.health.get(service) == "unhealthy"]
    if not flipped:
        return []
    return [
        Evidence(
            service=service,
            kind=EvidenceKind.HEALTH_CHECK,
            metric="health",
            baseline_value=None,
            observed_value=None,
            window_start=window_start,
            window_end=window_end,
            sample_count=len(flipped),
            detail=f"health probe reported '{service}' unhealthy for {len(flipped)}s during fault",
        )
    ]
