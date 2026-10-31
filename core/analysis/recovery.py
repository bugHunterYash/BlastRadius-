# =============================================================================
# core.analysis.recovery — did the service come back, and how long did it take?
# =============================================================================
# Honesty rules baked into the wording (spec: "Never assume recovery"):
#   - A window with ZERO requests does not prove health — it proves nothing.
#     Such buckets do NOT count toward the stable window (a dead target that
#     stopped receiving traffic would otherwise look 'recovered' at timeout).
#   - Timeout ⇒ recovered=False with "not recovered within <timeout>s".
#     NEVER round a timeout up to "probably recovered".
#   - recovery_time is measured from RESTORE (when the fault was removed),
#     not from the last unhealthy bucket — recovery time is a property of
#     the system's reconnect/warm-up behavior, and operators compare it
#     across runs using a consistent anchor.
#
# WHY N consecutive buckets (`recovery_stable_s`): one good second is noise
# (a retried connection, a cache hit). N consecutive good seconds is a
# pattern. Default 5, config-adjustable.
# =============================================================================

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from core.schemas.experiment import SLO
from core.schemas.metrics import MetricBucket


@dataclass(frozen=True)
class RecoveryResult:
    """Outcome of the recovery window. `reason` is the exact sentence the
    report uses — the report does NOT re-derive wording (single source of
    truth for the claim, so the UI card and the PDF can't diverge)."""

    recovered: bool
    recovered_at_s: float | None      # elapsed_s of the FIRST stable bucket
    recovery_time_s: float | None     # recovered_at_s - restore_elapsed_s
    reason: str


def measure_recovery(
    buckets: Sequence[MetricBucket],
    *,
    restore_elapsed_s: float,
    slo: SLO,
    stable_s: int = 5,
    timeout_s: int = 60,
) -> RecoveryResult:
    """Find the first post-restore window of `stable_s` consecutive
    healthy 1s buckets (see module header for 'healthy' semantics).

    buckets: ALL experiment buckets (pre-restore ones are filtered here, so
    callers can't accidentally include fault-phase data in the search).
    """
    post = [b for b in sorted(buckets, key=lambda b: b.elapsed_s)
            if b.elapsed_s >= restore_elapsed_s]

    if not post:
        return RecoveryResult(
            recovered=False,
            recovered_at_s=None,
            recovery_time_s=None,
            reason=f"no measurement data after restore (experiment ended before the recovery window)",
        )

    deadline = restore_elapsed_s + timeout_s

    def healthy(b: MetricBucket) -> bool:
        # Zero-request buckets prove nothing (see module header).
        if b.requests == 0:
            return False
        if b.error_rate > slo.max_error_rate:
            return False
        if b.p95_ms is not None and b.p95_ms > slo.p95_ms:
            return False
        return True

    run = 0
    for b in post:
        run = run + 1 if healthy(b) else 0
        if run >= stable_s:
            first_stable = b.elapsed_s - (stable_s - 1)
            # The full window must be OBSERVED before the deadline: a window
            # straddling it (e.g. 58..62 with deadline 60) completed too
            # late to count as "within timeout". Later windows start even
            # later, so we can stop at the first completed run.
            if b.elapsed_s < deadline:
                return RecoveryResult(
                    recovered=True,
                    recovered_at_s=first_stable,
                    recovery_time_s=first_stable - restore_elapsed_s,
                    reason=(
                        f"recovered {first_stable - restore_elapsed_s:.0f}s after restore "
                        f"({stable_s}s of healthy buckets)"
                    ),
                )
            break

    return RecoveryResult(
        recovered=False,
        recovered_at_s=None,
        recovery_time_s=None,
        reason=f"not recovered within {timeout_s}s of restore",
    )
