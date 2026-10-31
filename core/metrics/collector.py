# =============================================================================
# core.metrics.collector — RawSamples → MetricBucket seconds + raw persistence
# =============================================================================
# Two jobs, kept apart on purpose:
#
#   BucketAggregator: stateful, in-memory. add(sample) assigns the sample to
#   the 1-second bucket of its elapsed time t (already relative — see the
#   RawSample contract; the Joiner converts once upstream). flush_upto()
#   emits buckets whose second has fully elapsed (plus the current one at
#   run end), so every emitted bucket is final — k6 may backfill late points
#   only within their own second, and we never mutate an emitted bucket.
#
#   RawSink: append-only JSONL (optionally gzipped) of every RawSample, the
#   DURABLE source for analysis (phase_stats reads durations from it). Kept
#   separate from buckets because percentile math needs per-request latencies
#   while the API streams buckets — two different consumers, two shapes.
#
# WHY a phase-tag callback instead of importing the controller's schedule:
#   layering — metrics must not import controller. The aggregator receives
#   `mark(elapsed_s) -> (phase, multiplier, target_rps)` (a bound
#   PhaseSchedule.at) so bucket tagging follows the schedule without a
#   dependency edge. Health is {} until HealthProber lands (honesty: absent
#   map reads as unprobed, never as healthy).
# =============================================================================

from __future__ import annotations

import gzip
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from core.analysis.percentiles import compute_percentiles, p99_optional
from core.schemas.metrics import MetricBucket, RawSample

# mark() returns this triple — see core.controller.schedule.PhaseSchedule.at
MarkFn = Callable[[int], tuple[str, float, float]]

_BUCKET_S = 1.0


@dataclass
class _Acc:
    requests: int = 0
    failures: int = 0
    timeouts: int = 0
    durations: list[float] = field(default_factory=list)

    def observe(self, s: RawSample) -> None:
        self.requests += 1
        self.durations.append(s.duration_ms)
        if s.error:
            self.failures += 1
            # status 0 with an error = transport-level (connection refused /
            # timeout) — k6 tags no HTTP status then. 4xx/5xx are HTTP
            # failures, not "timeouts" in the report's sense.
            if s.status == 0:
                self.timeouts += 1


class BucketAggregator:
    """Folds RawSamples into 1-second MetricBuckets tagged by the schedule."""

    def __init__(self, start_epoch: float, mark: MarkFn) -> None:
        self.start_epoch = start_epoch
        self._mark = mark
        self._accs: dict[int, _Acc] = {}
        self.out_of_window = 0  # samples with negative elapsed (clock skew)

    def add(self, s: RawSample) -> None:
        # s.t is ALREADY elapsed seconds (RawSample contract — the Joiner
        # converts k6 epoch-ms → elapsed once, upstream).
        if s.t < 0:
            # Server/k6 clock disagreed with our recorded start. Dropping one
            # skewed sample beats tagging it as a "pre-start" second that
            # would show 0-request buckets before the run existed.
            self.out_of_window += 1
            return
        idx = int(s.t // _BUCKET_S)
        acc = self._accs.setdefault(idx, _Acc())
        acc.observe(s)

    def flush_upto(self, now_elapsed: int, *, include_current: bool = False) -> list[MetricBucket]:
        """Emit buckets with index < now_elapsed (all fully elapsed), or
        < now_elapsed+1 when include_current (run end — last partial second
        included so short runs aren't missing their tail)."""
        limit = now_elapsed + 1 if include_current else now_elapsed
        out: list[MetricBucket] = []
        for idx in sorted(k for k in self._accs if k < limit):
            acc = self._accs.pop(idx)
            out.append(self._build(idx, acc))
        return out

    def _build(self, idx: int, acc: _Acc) -> MetricBucket:
        phase, mult, target = self._mark(idx)
        pct = compute_percentiles(acc.durations)
        error_rate = acc.failures / acc.requests if acc.requests else 0.0
        return MetricBucket(
            t=datetime.fromtimestamp(self.start_epoch + idx, tz=timezone.utc),
            elapsed_s=float(idx),
            phase=phase,
            load_multiplier=mult,
            target_rps=target,
            requests=acc.requests,
            successes=acc.requests - acc.failures,
            failures=acc.failures,
            timeouts=acc.timeouts,
            rps=float(acc.requests) / _BUCKET_S,
            error_rate=error_rate,
            p50_ms=pct.p50_ms,
            p95_ms=pct.p95_ms,
            p99_ms=p99_optional(pct),
            max_ms=pct.max_ms,
            health={},  # no prober yet: absent = unprobed, never "healthy"
        )


class RawSink:
    """Append-only RawSample log: in-memory list (report input) + optional
    gzip JSONL file (durable per-implementation.md persistence notes)."""

    def __init__(self, path: Path | None = None) -> None:
        self.samples: list[RawSample] = []
        self.path = path
        self._fh = gzip.open(path, "wt", encoding="utf-8") if path else None

    def write(self, s: RawSample) -> None:
        self.samples.append(s)
        if self._fh is not None:
            self._fh.write(json.dumps({
                "t": s.t, "duration_ms": s.duration_ms, "endpoint": s.endpoint,
                "status": s.status, "error": s.error,
            }) + "\n")

    def close(self) -> None:
        if self._fh is not None:
            self._fh.close()
            self._fh = None

    @property
    def line_count(self) -> int:
        return len(self.samples)
