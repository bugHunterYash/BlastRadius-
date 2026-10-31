# =============================================================================
# Store tests — run: python tests/test_store.py
# =============================================================================
# Load-bearing assertion: the DB-LEVEL immutability trigger. If this test
# ever fails, config immutability regressed to application-code-only and a
# single careless UPDATE could rewrite experiment history.
# =============================================================================

from __future__ import annotations

import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from core.graph import build_graph
from core.parser import parse_compose
from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentState,
    ExperimentType,
    LoadConfig,
    PreflightCheck,
    PreflightResult,
)
from core.schemas.metrics import Evidence, EvidenceKind, MetricBucket, MetricStatus, OptionalMetric
from core.schemas.report import Report
from core.store import ConfigImmutable, NotFound, Store

FIXTURES = Path(__file__).resolve().parent / "fixtures"
PASS = 0
FAIL = 0
T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"  PASS  {name}")


def fail(name: str, detail: str) -> None:
    global FAIL
    FAIL += 1
    print(f"  FAIL  {name}: {detail}")


def assert_true(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        ok(name)
    else:
        fail(name, detail or "condition was false")


def clock():
    """Injectable now_fn: increments 1s per call so created_at ordering is
    deterministic across runs."""
    state = {"t": T0}

    def _now() -> datetime:
        state["t"] += timedelta(seconds=1)
        return state["t"]

    return _now


def make_experiment_config(name: str = "exp-1") -> ExperimentCreate:
    from core.schemas.experiment import FaultConfig, FaultKind
    return ExperimentCreate(
        name=name,
        type=ExperimentType.FAULT,
        load=LoadConfig(
            target_base_url="http://demo-api:3000",
            endpoints=["/api/cart"],
            baseline_rps=20,
            multipliers=[1.0],
            step_duration_s=100,   # load must cover fault timeline (20+20+60)
            ramp_s=0,
        ),
        fault=FaultConfig(kind=FaultKind.STOP_CONTAINER, target_service="demo-redis"),
    )


PREFLIGHT_OK = PreflightResult(
    passed=True,
    checks=[PreflightCheck(id="env-label", label="env labeled test", passed=True,
                           detail="label test ok")],
)


def bucket(elapsed: float, requests: int = 20) -> MetricBucket:
    return MetricBucket(
        t=T0.replace(tzinfo=None) + timedelta(seconds=elapsed),
        elapsed_s=elapsed,
        phase="baseline",
        load_multiplier=1.0,
        target_rps=20.0,
        requests=requests,
        successes=requests,
        failures=0,
        rps=float(requests),
        error_rate=0.0,
        p95_ms=100.0,
        p99_ms=OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE, reason="no samples"),
    )


def make_report(exp_id: UUID) -> Report:
    return Report(
        experiment_id=exp_id,
        generated_at=T0,
        config=make_experiment_config(),
        final_state=ExperimentState.COMPLETED,
    )


def main() -> int:
    # =========================================================================
    # graph roundtrip
    # =========================================================================
    model = parse_compose((FIXTURES / "demo-compose.yaml").read_text(encoding="utf-8"),
                          filename="demo-compose.yaml")
    graph = build_graph(model, name="demo")
    with Store(":memory:", now_fn=clock()) as store:
        store.save_graph(graph)
        got = store.get_graph(graph.id)
        assert_true("graph roundtrip byte-identical",
                    got.model_dump_json() == graph.model_dump_json())

        try:
            store.get_graph(uuid4())
            fail("graph NotFound", "no exception raised")
        except NotFound:
            ok("missing graph raises NotFound")

        # =====================================================================
        # experiment lifecycle
        # =====================================================================
        eid = uuid4()
        config = make_experiment_config()
        rec = store.create_experiment(eid, config, PREFLIGHT_OK)
        assert_true("create returns PENDING record", rec.state == ExperimentState.PENDING)
        assert_true("config roundtrip", rec.config == config)
        assert_true("preflight roundtrip", rec.preflight == PREFLIGHT_OK)
        # Deterministic clock: tick 1 was consumed by save_graph above,
        # so create_experiment lands exactly on T0+2s.
        assert_true("created_at from injected clock (T0+2s)",
                    rec.created_at == T0 + timedelta(seconds=2),
                    f"got {rec.created_at}")

        store.set_experiment_state(eid, ExperimentState.RUNNING, started_at=T0)
        store.set_experiment_state(
            eid, ExperimentState.AUTO_STOPPED, ended_at=T0 + timedelta(seconds=100),
            stop_reason="Safety auto-stop: error rate 63% > 50% for 5s",
        )
        rec = store.get_experiment(eid)
        assert_true("state transitions persist",
                    rec.state == ExperimentState.AUTO_STOPPED
                    and rec.started_at == T0
                    and rec.ended_at == T0 + timedelta(seconds=100))
        assert_true("stop_reason persists", (rec.stop_reason or "").startswith("Safety auto-stop"))

        try:
            store.set_experiment_state(uuid4(), ExperimentState.RUNNING)
            fail("state NotFound", "no exception")
        except NotFound:
            ok("state update on unknown id raises NotFound")

        # =====================================================================
        # THE immutability trigger (spec invariant #7 of persistence)
        # =====================================================================
        try:
            # Bypass the Store entirely — the DB itself must refuse.
            store._conn.execute(
                "UPDATE experiments SET config = ? WHERE id = ?",
                ("{}".format("{}"), str(eid)),
            )
            fail("config immutability", "trigger allowed a config UPDATE")
        except sqlite3.IntegrityError as e:
            assert_true("DB trigger blocks config UPDATE",
                        "immutable" in str(e), f"got {e}")

        # connection still usable after the aborted statement, and the
        # legitimate state-only path is unaffected:
        store.set_experiment_state(eid, ExperimentState.COMPLETED, ended_at=T0)
        assert_true("state-only update still works after trigger abort",
                    store.get_experiment(eid).state == ExperimentState.COMPLETED)

        try:
            store.create_experiment(eid, config, PREFLIGHT_OK)
            fail("duplicate id", "no exception")
        except sqlite3.IntegrityError:
            ok("duplicate experiment id rejected by PK")

        # =====================================================================
        # compared_to + raw samples path
        # =====================================================================
        other = uuid4()
        store.create_experiment(other, make_experiment_config("exp-2"), PREFLIGHT_OK)
        store.set_compared_to(other, eid)
        rec2 = store.get_experiment(other)
        assert_true("compared_to link persists", rec2.compared_to == eid)
        store.set_raw_samples_path(other, "raw/abc.jsonl.gz")
        assert_true("raw samples path persists",
                    store.get_experiment(other).raw_samples_path == "raw/abc.jsonl.gz")

        # =====================================================================
        # list ordering (newest first; injected clock guarantees distinct ts)
        # =====================================================================
        listing = store.list_experiments()
        assert_true("list has both experiments", len(listing) == 2)
        assert_true("newest first", listing[0].name == "exp-2",
                    f"got {[r.name for r in listing]}")

        # =====================================================================
        # buckets: batch save, ordering, replace, filter
        # =====================================================================
        store.save_buckets(eid, [bucket(0), bucket(1), bucket(2)])
        assert_true("buckets returned time-ordered",
                    [b.elapsed_s for b in store.get_buckets(eid)] == [0.0, 1.0, 2.0])
        store.save_buckets(eid, [bucket(1, requests=99)])   # correction to second 1
        got = store.get_buckets(eid)
        assert_true("re-save replaces, never duplicates",
                    len(got) == 3 and got[1].requests == 99,
                    f"got {[(b.elapsed_s, b.requests) for b in got]}")
        assert_true("from_elapsed filter",
                    [b.elapsed_s for b in store.get_buckets(eid, from_elapsed=2.0)] == [2.0])
        assert_true("empty save is a no-op (no exception)",
                    store.save_buckets(eid, []) is None)

        # =====================================================================
        # evidence seq assignment
        # =====================================================================
        ev1 = Evidence(
            service="demo-api", kind=EvidenceKind.REQUEST_ERRORS,
            metric="error_rate:/api/cart", baseline_value=0.0, observed_value=0.75,
            window_start=T0, window_end=T0, sample_count=40, detail="0% → 75%",
        )
        ev2 = Evidence(
            service="demo-worker", kind=EvidenceKind.HEALTH_CHECK, metric="health",
            baseline_value=None, observed_value=None,
            window_start=T0, window_end=T0, sample_count=5, detail="unhealthy 5s",
        )
        seq1 = store.append_evidence(eid, ev1)
        seq2 = store.append_evidence(eid, ev2)
        rows = store.get_evidence(eid)
        assert_true("evidence seqs assigned 1,2", (seq1, seq2) == (1, 2),
                    f"got {(seq1, seq2)}")
        assert_true("evidence returned in seq order",
                    [r.service for r in rows] == ["demo-api", "demo-worker"])

        # =====================================================================
        # phase markers (replace semantics)
        # =====================================================================
        store.mark_phase(eid, "baseline", 0.0)
        store.mark_phase(eid, "fault", 20.0)
        store.mark_phase(eid, "fault", 21.0)   # re-marking replaces
        markers = store.get_phase_markers(eid)
        assert_true("phase markers replace on re-mark",
                    markers == {"baseline": 0.0, "fault": 21.0}, f"got {markers}")

        # =====================================================================
        # report roundtrip
        # =====================================================================
        report = make_report(eid)
        store.save_report(report)
        got_report = store.get_report(eid)
        assert_true("report roundtrip byte-identical",
                    got_report.model_dump_json() == report.model_dump_json())
        try:
            store.get_report(uuid4())
            fail("report NotFound", "no exception")
        except NotFound:
            ok("missing report raises NotFound")

    # =========================================================================
    # file-backed persistence across instances
    # =========================================================================
    with tempfile.TemporaryDirectory() as tmp:
        db = str(Path(tmp) / "test.db")
        eid2 = uuid4()
        with Store(db, now_fn=clock()) as s1:
            s1.create_experiment(eid2, make_experiment_config(), PREFLIGHT_OK)
            s1.save_report(make_report(eid2))
        with Store(db, now_fn=clock()) as s2:
            rec = s2.get_experiment(eid2)
            assert_true("file DB persists across Store instances",
                        rec.config.name == "exp-1")
            assert_true("report persists across instances",
                        s2.get_report(eid2).final_state == ExperimentState.COMPLETED)

    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
