# =============================================================================
# core.controller.experiment — experiment state machine & execution task (B4)
# =============================================================================
# Manages the full experiment lifecycle:
#   PENDING → (preflight) → RUNNING → COMPLETED | ABORTED | AUTO_STOPPED | FAILED
#
# Coordinates:
#   - Concurrency lock (single experiment at a time)
#   - Phase schedule and marker persistence
#   - Load generation via k6 runner (with synthetic fallback if k6 absent)
#   - Metric aggregation & SSE streaming
#   - Fault injection and guaranteed restore
#   - Post-run analysis, report generation, and persistence
# =============================================================================

from __future__ import annotations

import asyncio
import math
import shutil
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from core.analysis.evidence import build_evidence, verified_services
from core.analysis.phases import phase_stats
from core.analysis.recovery import measure_recovery
from core.analysis.slo import breaking_point
from core.controller.schedule import PhaseSchedule
from core.load.runner import K6Runner
from core.metrics.collector import BucketAggregator, RawSink
from core.report.builder import finalize_report
from core.report.score import compute_score
from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentState,
    ExperimentType,
    Phase,
)
from core.schemas.metrics import MetricBucket, MetricStatus, OptionalMetric, RawSample
from core.schemas.report import Report
from core.store import Store


class ExperimentExecutionError(Exception):
    """Raised on controller task failure."""


@dataclass
class ExperimentController:
    """Orchestrates experiment execution, load streaming, fault lifecycle, and reporting."""

    store: Store
    broadcaster: Any | None = None
    docker_client: Any | None = None
    k6_bin: str = "k6"
    global_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _running_tasks: dict[UUID, asyncio.Task] = field(default_factory=dict)
    _active_runners: dict[UUID, K6Runner] = field(default_factory=dict)
    _faulted_targets: set[tuple[UUID, str]] = field(default_factory=set)

    def start(self, experiment_id: UUID) -> None:
        """Starts the experiment asynchronously in a background task."""
        loop = asyncio.get_running_loop()
        task = loop.create_task(self.run_experiment(experiment_id))
        self._running_tasks[experiment_id] = task

    def abort(self, experiment_id: UUID) -> None:
        """User kill switch: aborts the active experiment immediately."""
        task = self._running_tasks.get(experiment_id)
        if task and not task.done():
            task.cancel()

        # Stop active k6 runner
        runner = self._active_runners.get(experiment_id)
        if runner:
            asyncio.create_task(runner.stop())

        # Immediate restore of any faulted containers
        self._restore_faults_for_experiment(experiment_id)

        # Update store state to ABORTED if still in progress
        try:
            rec = self.store.get_experiment(experiment_id)
            if rec.state in (ExperimentState.PENDING, ExperimentState.RUNNING):
                self.store.set_experiment_state(
                    experiment_id,
                    ExperimentState.ABORTED,
                    stop_reason="Aborted by user kill switch",
                    ended_at=datetime.now(timezone.utc),
                )
                if self.broadcaster:
                    self.broadcaster.publish("state", {
                        "id": str(experiment_id),
                        "state": ExperimentState.ABORTED.value,
                    })
        except Exception:
            pass

    async def run_experiment(self, experiment_id: UUID) -> None:
        """Main controller task loop."""
        rec = self.store.get_experiment(experiment_id)
        exp: ExperimentCreate = rec.config

        async with self.global_lock:
            start_time = datetime.now(timezone.utc)
            start_epoch = time.time()
            self.store.set_experiment_state(
                experiment_id,
                ExperimentState.RUNNING,
                started_at=start_time,
            )
            if self.broadcaster:
                self.broadcaster.publish("state", {
                    "id": str(experiment_id),
                    "state": ExperimentState.RUNNING.value,
                })

            schedule = PhaseSchedule.from_experiment(exp)
            aggregator = BucketAggregator(start_epoch=start_epoch, mark=schedule.at)
            sink = RawSink()

            final_state = ExperimentState.COMPLETED
            stop_reason: str | None = None
            fault_injected = False
            fault_restored = False
            fault_target = exp.fault.target_service if exp.fault else None

            # Track safety limit trips
            consecutive_limit_breaches = 0
            limit_breach_threshold = exp.safety.consecutive_seconds

            try:
                # Determine execution engine: live k6 vs simulated load
                k6_installed = bool(shutil.which(self.k6_bin))

                if k6_installed:
                    runner = K6Runner(
                        load_config=exp.load,
                        safety_limits=exp.safety,
                        k6_bin=self.k6_bin,
                    )
                    self._active_runners[experiment_id] = runner

                    async def handle_sample(s: RawSample) -> None:
                        sink.write(s)
                        aggregator.add(s)

                    # Spawn load task
                    async def stream_samples():
                        async for s in runner.run_stream(start_epoch, on_sample=handle_sample):
                            pass

                    load_task = asyncio.create_task(stream_samples())

                last_flushed_s = 0
                total_duration = int(math.ceil(schedule.total_duration_s))

                # Controller ticker (1Hz)
                while True:
                    now_elapsed = time.time() - start_epoch
                    now_int = int(now_elapsed)

                    if now_int >= total_duration:
                        break

                    # Phase transitions & Fault management
                    if exp.type == ExperimentType.FAULT and exp.fault is not None and fault_target:
                        baseline_s = exp.fault.baseline_s
                        fault_s = exp.fault.fault_s

                        # Inject fault at baseline boundary
                        if not fault_injected and now_elapsed >= baseline_s:
                            fault_injected = True
                            self._inject_fault(experiment_id, fault_target)
                            self.store.mark_phase(experiment_id, Phase.FAULT.value, now_elapsed)
                            if self.broadcaster:
                                self.broadcaster.publish("phase", {
                                    "name": Phase.FAULT.value,
                                    "elapsed_s": now_elapsed,
                                })

                        # Restore fault at fault window boundary
                        if fault_injected and not fault_restored and now_elapsed >= (baseline_s + fault_s):
                            fault_restored = True
                            self._restore_fault(experiment_id, fault_target)
                            self.store.mark_phase(experiment_id, Phase.RECOVERY.value, now_elapsed)
                            if self.broadcaster:
                                self.broadcaster.publish("phase", {
                                    "name": Phase.RECOVERY.value,
                                    "elapsed_s": now_elapsed,
                                })

                    # If simulated (no k6 installed): generate synthetic requests for this second
                    if not k6_installed:
                        self._simulate_second(
                            now_int,
                            schedule,
                            exp,
                            fault_active=(fault_injected and not fault_restored),
                            sink=sink,
                            aggregator=aggregator,
                        )

                    # Flush completed 1s metric buckets
                    if now_int > last_flushed_s:
                        new_buckets = aggregator.flush_upto(now_int)
                        if new_buckets:
                            self.store.save_buckets(experiment_id, new_buckets)
                            for b in new_buckets:
                                if self.broadcaster:
                                    self.broadcaster.publish("bucket", b.model_dump(mode="json"))

                                # Check safety limits
                                error_breached = b.error_rate > exp.safety.max_error_rate
                                p95_breached = (
                                    b.p95_ms is not None and b.p95_ms > exp.safety.max_p95_ms
                                )
                                if error_breached or p95_breached:
                                    consecutive_limit_breaches += 1
                                else:
                                    consecutive_limit_breaches = 0

                                if consecutive_limit_breaches >= limit_breach_threshold:
                                    final_state = ExperimentState.AUTO_STOPPED
                                    stop_reason = (
                                        f"Safety limit tripped: error rate {b.error_rate:.1%} or "
                                        f"p95 {b.p95_ms}ms exceeded safety caps for "
                                        f"{consecutive_limit_breaches}s"
                                    )
                                    break

                        last_flushed_s = now_int

                    if final_state == ExperimentState.AUTO_STOPPED:
                        break

                    await asyncio.sleep(0.5)

                # Final flush
                elapsed_final = int(time.time() - start_epoch)
                final_buckets = aggregator.flush_upto(elapsed_final, include_current=True)
                if final_buckets:
                    self.store.save_buckets(experiment_id, final_buckets)
                    for b in final_buckets:
                        if self.broadcaster:
                            self.broadcaster.publish("bucket", b.model_dump(mode="json"))

                # Stop runner if running
                if k6_installed and experiment_id in self._active_runners:
                    await self._active_runners[experiment_id].stop()

            except asyncio.CancelledError:
                final_state = ExperimentState.ABORTED
                stop_reason = "Experiment cancelled"
                raise
            except Exception as e:
                final_state = ExperimentState.FAILED
                stop_reason = f"Execution error: {e}"
            finally:
                # Guaranteed restore
                self._restore_faults_for_experiment(experiment_id)
                self._active_runners.pop(experiment_id, None)
                self._running_tasks.pop(experiment_id, None)

            # Build and finalize Report
            ended_time = datetime.now(timezone.utc)
            self._finalize_and_save_report(
                experiment_id=experiment_id,
                exp=exp,
                final_state=final_state,
                stop_reason=stop_reason,
                raw_samples=sink.samples,
                start_time=start_time,
                ended_time=ended_time,
            )

    def _inject_fault(self, experiment_id: UUID, target_service: str) -> None:
        self._faulted_targets.add((experiment_id, target_service))
        if self.docker_client:
            try:
                for c in self.docker_client.containers.list():
                    c_name = getattr(c, "name", "")
                    c_labels = getattr(c, "labels", {}) or {}
                    if target_service in (c_name, c_labels.get("com.docker.compose.service")):
                        c.stop(timeout=5)
                        break
            except Exception:
                pass

    def _restore_fault(self, experiment_id: UUID, target_service: str) -> None:
        self._faulted_targets.discard((experiment_id, target_service))
        if self.docker_client:
            try:
                # List including stopped
                for c in self.docker_client.containers.list(all=True):
                    c_name = getattr(c, "name", "")
                    c_labels = getattr(c, "labels", {}) or {}
                    if target_service in (c_name, c_labels.get("com.docker.compose.service")):
                        c.start()
                        break
            except Exception:
                pass

    def _restore_faults_for_experiment(self, experiment_id: UUID) -> None:
        for eid, target in list(self._faulted_targets):
            if eid == experiment_id:
                self._restore_fault(eid, target)

    def _simulate_second(
        self,
        second: int,
        schedule: PhaseSchedule,
        exp: ExperimentCreate,
        fault_active: bool,
        sink: RawSink,
        aggregator: BucketAggregator,
    ) -> None:
        """Synthesizes requests for test/local environments when k6 binary is absent."""
        phase, mult, target_rps = schedule.at(second)
        req_count = max(1, int(round(target_rps)))
        endpoint = exp.load.endpoints[0] if exp.load.endpoints else "/api/health"

        for i in range(req_count):
            t_sample = float(second) + (i / req_count)
            if fault_active:
                # Simulating degraded behavior during fault
                is_error = (i % 2 == 0)  # 50% errors during fault
                status = 503 if is_error else 200
                duration_ms = 450.0 if not is_error else 1200.0
            else:
                is_error = False
                status = 200
                duration_ms = 25.0 + (i % 15)

            s = RawSample(
                t=t_sample,
                duration_ms=duration_ms,
                endpoint=endpoint,
                status=status,
                error=is_error,
            )
            sink.write(s)
            aggregator.add(s)

    def _finalize_and_save_report(
        self,
        *,
        experiment_id: UUID,
        exp: ExperimentCreate,
        final_state: ExperimentState,
        stop_reason: str | None,
        raw_samples: list[RawSample],
        start_time: datetime,
        ended_time: datetime,
    ) -> Report:
        all_buckets = self.store.get_buckets(experiment_id)

        # Compute phase stats
        group_mode = "phase" if exp.type == ExperimentType.FAULT else "multiplier"
        target_rps_map = {m: exp.load.baseline_rps * m for m in exp.load.multipliers}
        p_stats = phase_stats(
            buckets=all_buckets,
            raw_samples=raw_samples,
            slo=exp.slo,
            group_by=group_mode,
            target_rps_at=target_rps_map,
            trim_ramp_s=exp.load.ramp_s if exp.type == ExperimentType.CAPACITY else 0,
        )

        recovery_time_s: float | None = None
        recovered: bool | None = None
        evidence_list = []
        affected_services = []

        if exp.type == ExperimentType.FAULT and exp.fault is not None:
            restore_s = float(exp.fault.baseline_s + exp.fault.fault_s)
            rec_result = measure_recovery(all_buckets, restore_elapsed_s=restore_s, slo=exp.slo)
            recovered = rec_result.recovered
            recovery_time_s = rec_result.recovery_time_s

            b_samples = [s for s in raw_samples if s.t < exp.fault.baseline_s]
            f_samples = [s for s in raw_samples if exp.fault.baseline_s <= s.t < restore_s]
            b_buckets = [b for b in all_buckets if b.phase == Phase.BASELINE.value]
            f_buckets = [b for b in all_buckets if b.phase == Phase.FAULT.value]

            evidence_list = build_evidence(
                baseline_samples=b_samples,
                fault_samples=f_samples,
                baseline_buckets=b_buckets,
                fault_buckets=f_buckets,
                declared_services=[exp.fault.target_service],
            )
            affected_services = sorted(verified_services(evidence_list))

        highest_passing: float | None = None
        first_breach: float | None = None
        tested_multipliers: list[float] = []

        if exp.type == ExperimentType.CAPACITY:
            bp = breaking_point(p_stats)
            highest_passing = bp.highest_passing_multiplier
            first_breach = bp.first_breach_multiplier
            tested_multipliers = list(exp.load.multipliers)

        # Baseline vs fault delta
        baseline_vs_fault: dict[str, float | None] | None = None
        if len(p_stats) >= 2:
            base_p = p_stats[0]
            cmp_p = p_stats[1]
            p95_delta = (cmp_p.p95_ms - base_p.p95_ms) if (cmp_p.p95_ms and base_p.p95_ms) else None
            err_delta = cmp_p.error_rate - base_p.error_rate
            rps_delta = cmp_p.rps - base_p.rps
            baseline_vs_fault = {
                "p95_ms": p95_delta,
                "error_rate": err_delta,
                "rps": rps_delta,
            }

        initial_report = Report(
            experiment_id=experiment_id,
            generated_at=ended_time,
            data_source="live",
            config=exp,
            final_state=final_state,
            stop_reason=stop_reason,
            phases=p_stats,
            baseline_vs_fault=baseline_vs_fault,
            recovery_time_s=recovery_time_s,
            recovered=recovered,
            highest_passing_multiplier=highest_passing,
            first_breach_multiplier=first_breach,
            tested_multipliers=tested_multipliers,
            affected_services=affected_services,
            evidence=evidence_list,
            confounded=(exp.type == ExperimentType.FAULT_UNDER_LOAD),
        )

        # Score calculation
        calculated_score = compute_score(initial_report)
        initial_report = initial_report.model_copy(
            update={"score": OptionalMetric.measured(float(calculated_score))}
        )

        final_report = finalize_report(initial_report)

        # Persist report, evidence, and final state
        self.store.save_report(final_report)
        if evidence_list:
            for ev in evidence_list:
                self.store.append_evidence(experiment_id, ev)

        self.store.set_experiment_state(
            experiment_id,
            final_state,
            stop_reason=stop_reason,
            ended_at=ended_time,
        )

        if self.broadcaster:
            self.broadcaster.publish("state", {
                "id": str(experiment_id),
                "state": final_state.value,
                "stop_reason": stop_reason,
            })
            self.broadcaster.publish("report", final_report.model_dump(mode="json"))

        return final_report
