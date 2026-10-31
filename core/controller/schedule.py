# =============================================================================
# core.controller.schedule — phase timeline, multiplier steps & bucket tagging
# =============================================================================
# Computes the experiment's schedule across phases (baseline, fault, recovery
# or capacity load steps). Provides the .at(elapsed_s) callback passed to
# BucketAggregator for tagging 1-second metric buckets.
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from typing import NamedTuple

from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentType,
    Phase,
)


class PhaseSegment(NamedTuple):
    start_elapsed: float
    end_elapsed: float
    phase: str
    load_multiplier: float
    target_rps: float


@dataclass
class PhaseSchedule:
    """Calculates phase timing and provides .at(elapsed_s) for metric aggregation."""

    segments: list[PhaseSegment]
    total_duration_s: float

    @classmethod
    def from_experiment(cls, exp: ExperimentCreate) -> PhaseSchedule:
        segments: list[PhaseSegment] = []
        cur_elapsed = 0.0

        if exp.type == ExperimentType.FAULT and exp.fault is not None:
            baseline_s = float(exp.fault.baseline_s)
            fault_s = float(exp.fault.fault_s)
            recovery_s = float(exp.fault.recovery_timeout_s)
            base_rps = float(exp.load.baseline_rps)

            # Baseline phase
            segments.append(PhaseSegment(
                start_elapsed=cur_elapsed,
                end_elapsed=cur_elapsed + baseline_s,
                phase=Phase.BASELINE.value,
                load_multiplier=1.0,
                target_rps=base_rps,
            ))
            cur_elapsed += baseline_s

            # Fault phase
            segments.append(PhaseSegment(
                start_elapsed=cur_elapsed,
                end_elapsed=cur_elapsed + fault_s,
                phase=Phase.FAULT.value,
                load_multiplier=1.0,
                target_rps=base_rps,
            ))
            cur_elapsed += fault_s

            # Recovery phase
            segments.append(PhaseSegment(
                start_elapsed=cur_elapsed,
                end_elapsed=cur_elapsed + recovery_s,
                phase=Phase.RECOVERY.value,
                load_multiplier=1.0,
                target_rps=base_rps,
            ))
            cur_elapsed += recovery_s

        elif exp.type == ExperimentType.CAPACITY:
            step_s = float(exp.load.step_duration_s)
            ramp_s = float(exp.load.ramp_s)
            per_step = step_s + ramp_s
            base_rps = float(exp.load.baseline_rps)

            for m in exp.load.multipliers:
                target_rps = base_rps * m
                segments.append(PhaseSegment(
                    start_elapsed=cur_elapsed,
                    end_elapsed=cur_elapsed + per_step,
                    phase=Phase.LOAD_STEP.value,
                    load_multiplier=float(m),
                    target_rps=target_rps,
                ))
                cur_elapsed += per_step

        else:  # FAULT_UNDER_LOAD or fallback
            step_s = float(exp.load.step_duration_s)
            ramp_s = float(exp.load.ramp_s)
            per_step = step_s + ramp_s
            base_rps = float(exp.load.baseline_rps)

            for m in exp.load.multipliers:
                target_rps = base_rps * m
                segments.append(PhaseSegment(
                    start_elapsed=cur_elapsed,
                    end_elapsed=cur_elapsed + per_step,
                    phase=Phase.LOAD_STEP.value,
                    load_multiplier=float(m),
                    target_rps=target_rps,
                ))
                cur_elapsed += per_step

        return cls(segments=segments, total_duration_s=cur_elapsed)

    def at(self, elapsed_s: int | float) -> tuple[str, float, float]:
        """Returns (phase_name, load_multiplier, target_rps) for a given elapsed time.
        Satisfies MarkFn signature in core.metrics.collector."""
        t = float(elapsed_s)
        for seg in self.segments:
            if seg.start_elapsed <= t < seg.end_elapsed:
                return (seg.phase, seg.load_multiplier, seg.target_rps)

        # Fallback if beyond scheduled duration: return final segment's parameters
        if self.segments:
            last = self.segments[-1]
            return (last.phase, last.load_multiplier, last.target_rps)
        return ("unknown", 1.0, 0.0)

    @property
    def markers(self) -> list[tuple[str, float]]:
        """List of (phase_name, start_elapsed) markers."""
        return [(seg.phase, seg.start_elapsed) for seg in self.segments]
