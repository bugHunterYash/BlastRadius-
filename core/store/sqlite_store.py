# =============================================================================
# core.store.sqlite_store — experiment/graph/report persistence (I1 write paths)
# =============================================================================
# WHY SQLite here (plan: "PostgreSQL; CLI may run ephemeral (or SQLite) for
# quick local runs"): this Store speaks stdlib `sqlite3` only — zero deps, so
# the CLI works today on this machine (no network for pip, no server needed)
# and tests run against `:memory:`. The backend's Postgres path will be a
# second implementation behind the SAME method names (save_graph, get_report,
# ...) so callers don't care which engine they got.
#
# WHY a DB-level immutability TRIGGER on experiments.config:
#   "Config immutable once started" is a spec invariant (report must describe
#   what was ASKED for). Enforcing it only in application code means one
#   careless UPDATE elsewhere silently rewrites history. The trigger makes the
#   database itself refuse `UPDATE experiments SET config=...` with an
#   abort error — application bugs fail loudly at write time, not at report
#   time, and not only where someone remembered the guard.
#
# JSON columns vs relational columns: user-facing payloads (config, graph,
# report, bucket rows) are stored as JSONB TEXT via Pydantic's
# model_dump_json — single source of truth stays in core/schemas, no schema
# drift between Python models and SQL columns. Denormalized scalar columns
# (state, created_at, compared_to, name) exist only for list/filter queries
# that JSON would make awkward.
#
# Batching (spec I1): buckets are written in batches every 5s by the
# controller, not per-second — this Store accepts whole lists per call;
# PK is (experiment_id, elapsed_s) with INSERT OR REPLACE so a re-batch
# overwrites seconds authoritatively (a bucket is defined as "second t",
# so replace-on-conflict is the correct semantics, not append).
#
# Thread affinity: one connection with check_same_thread=False + an internal
# RLock. The API (event loop thread) and the controller task share one Store;
# SQLite serializes us anyway, the lock keeps multi-statement ops atomic.
# =============================================================================

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable
from uuid import UUID

from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentState,
    ExperimentType,
    PreflightResult,
)
from core.schemas.graph import ArchitectureGraph
from core.schemas.metrics import Evidence, MetricBucket
from core.schemas.report import Report


class StoreError(Exception):
    """Base class for persistence failures."""


class NotFound(StoreError):
    """Requested row does not exist — API maps this to 404."""


class ConfigImmutable(StoreError):
    """The DB trigger refused a config rewrite (application bug caller-side)."""


@dataclass(frozen=True)
class ExperimentRecord:
    """What the store knows about one experiment (bucket/report payloads are
    fetched separately — list endpoints must not drag 100k buckets along)."""

    id: UUID
    name: str
    type: ExperimentType
    config: ExperimentCreate
    state: ExperimentState
    preflight: PreflightResult
    compared_to: UUID | None
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    stop_reason: str | None
    raw_samples_path: str | None


_SCHEMA = """
CREATE TABLE IF NOT EXISTS architecture_graphs (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    graph       TEXT NOT NULL            -- ArchitectureGraph JSON
);

CREATE TABLE IF NOT EXISTS experiments (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    type              TEXT NOT NULL,
    config            TEXT NOT NULL,     -- ExperimentCreate JSON (IMMUTABLE)
    state             TEXT NOT NULL,
    preflight          TEXT NOT NULL,    -- PreflightResult JSON
    compared_to       TEXT,
    created_at        TEXT NOT NULL,
    started_at        TEXT,
    ended_at          TEXT,
    stop_reason       TEXT,
    raw_samples_path  TEXT
);

-- Spec invariant: config is immutable after creation. Enforced by the
-- database itself so no application code path can bypass it.
CREATE TRIGGER IF NOT EXISTS experiments_config_immutable
BEFORE UPDATE OF config ON experiments
BEGIN
    SELECT RAISE(ABORT, 'experiment config is immutable after creation');
END;

CREATE TABLE IF NOT EXISTS metric_buckets (
    experiment_id  TEXT NOT NULL,
    elapsed_s      REAL NOT NULL,        -- PK part 2: one row per second
    bucket         TEXT NOT NULL,        -- MetricBucket JSON
    PRIMARY KEY (experiment_id, elapsed_s)
);

CREATE TABLE IF NOT EXISTS evidence (
    experiment_id  TEXT NOT NULL,
    seq            INTEGER NOT NULL,     -- creation order within run
    row            TEXT NOT NULL,        -- Evidence JSON
    PRIMARY KEY (experiment_id, seq)
);

CREATE TABLE IF NOT EXISTS phase_markers (
    experiment_id  TEXT NOT NULL,
    name           TEXT NOT NULL,        -- baseline | fault | recovery ...
    elapsed_s      REAL NOT NULL,
    PRIMARY KEY (experiment_id, name)
);

CREATE TABLE IF NOT EXISTS reports (
    experiment_id  TEXT PRIMARY KEY,     -- 1:1 with the run it describes
    report         TEXT NOT NULL         -- Report JSON
);

-- Landing-page waitlist (Pro/Team interest). Email is the identity, so a
-- repeat signup is a no-op rather than a duplicate row.
CREATE TABLE IF NOT EXISTS waitlist (
    email       TEXT PRIMARY KEY,
    plan        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buckets_exp
    ON metric_buckets (experiment_id, elapsed_s);
"""


class Store:
    """SQLite-backed store. Usable as a context manager.

        with Store(":memory:") as store:
            store.create_experiment(...)

    `now_fn` is injectable so tests pin timestamps (determinism — the same
    call sequence must produce identical rows across runs).
    """

    def __init__(
        self,
        path: str = "blastradius.db",
        *,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self._now = now_fn or (lambda: datetime.now(timezone.utc))
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock, self._conn:
            if path != ":memory:":
                self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def __enter__(self) -> Store:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # --- graphs ---------------------------------------------------------------

    def save_graph(self, graph: ArchitectureGraph) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO architecture_graphs (id, name, created_at, graph) "
                "VALUES (?, ?, ?, ?)",
                (
                    str(graph.id),
                    graph.name,
                    self._now().isoformat(),
                    graph.model_dump_json(),
                ),
            )

    def get_graph(self, graph_id: UUID) -> ArchitectureGraph:
        row = self._conn.execute(
            "SELECT graph FROM architecture_graphs WHERE id = ?", (str(graph_id),)
        ).fetchone()
        if row is None:
            raise NotFound(f"graph {graph_id} not found")
        return ArchitectureGraph.model_validate_json(row["graph"])

    # --- experiments ----------------------------------------------------------

    def create_experiment(
        self,
        experiment_id: UUID,
        config: ExperimentCreate,
        preflight: PreflightResult,
        *,
        state: ExperimentState = ExperimentState.PENDING,
    ) -> ExperimentRecord:
        now = self._now().isoformat()
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO experiments "
                "(id, name, type, config, state, preflight, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    str(experiment_id),
                    config.name,
                    config.type.value,
                    config.model_dump_json(),
                    state.value,
                    preflight.model_dump_json(),
                    now,
                ),
            )
        return self.get_experiment(experiment_id)

    def get_experiment(self, experiment_id: UUID) -> ExperimentRecord:
        row = self._conn.execute(
            "SELECT * FROM experiments WHERE id = ?", (str(experiment_id),)
        ).fetchone()
        if row is None:
            raise NotFound(f"experiment {experiment_id} not found")
        return ExperimentRecord(
            id=UUID(row["id"]),
            name=row["name"],
            type=ExperimentType(row["type"]),
            config=ExperimentCreate.model_validate_json(row["config"]),
            state=ExperimentState(row["state"]),
            preflight=PreflightResult.model_validate_json(row["preflight"]),
            compared_to=UUID(row["compared_to"]) if row["compared_to"] else None,
            created_at=datetime.fromisoformat(row["created_at"]),
            started_at=datetime.fromisoformat(row["started_at"]) if row["started_at"] else None,
            ended_at=datetime.fromisoformat(row["ended_at"]) if row["ended_at"] else None,
            stop_reason=row["stop_reason"],
            raw_samples_path=row["raw_samples_path"],
        )

    def set_experiment_state(
        self,
        experiment_id: UUID,
        state: ExperimentState,
        *,
        started_at: datetime | None = None,
        ended_at: datetime | None = None,
        stop_reason: str | None = None,
    ) -> None:
        """State-only update — never names the `config` column, so the
        immutability trigger stays happy by construction."""
        sets = ["state = ?"]
        params: list[object] = [state.value]
        if started_at is not None:
            sets.append("started_at = ?")
            params.append(started_at.isoformat())
        if ended_at is not None:
            sets.append("ended_at = ?")
            params.append(ended_at.isoformat())
        if stop_reason is not None:
            sets.append("stop_reason = ?")
            params.append(stop_reason)
        params.append(str(experiment_id))
        with self._lock, self._conn:
            cur = self._conn.execute(
                f"UPDATE experiments SET {', '.join(sets)} WHERE id = ?", params
            )
            if cur.rowcount == 0:
                raise NotFound(f"experiment {experiment_id} not found")

    def set_compared_to(self, experiment_id: UUID, other_id: UUID) -> None:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "UPDATE experiments SET compared_to = ? WHERE id = ?",
                (str(other_id), str(experiment_id)),
            )
            if cur.rowcount == 0:
                raise NotFound(f"experiment {experiment_id} not found")

    def set_raw_samples_path(self, experiment_id: UUID, path: str) -> None:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "UPDATE experiments SET raw_samples_path = ? WHERE id = ?",
                (path, str(experiment_id)),
            )
            if cur.rowcount == 0:
                raise NotFound(f"experiment {experiment_id} not found")

    def list_experiments(self) -> list[ExperimentRecord]:
        rows = self._conn.execute(
            "SELECT id FROM experiments ORDER BY created_at DESC, id"
        ).fetchall()
        return [self.get_experiment(UUID(r["id"])) for r in rows]

    # --- buckets ---------------------------------------------------------------

    def save_buckets(self, experiment_id: UUID, buckets: list[MetricBucket]) -> None:
        """Batched write (controller flushes every 5s). Replace-on-conflict:
        a bucket IS second `elapsed_s` — later writes are corrections, not
        appends."""
        if not buckets:
            return
        payload = [
            (str(experiment_id), b.elapsed_s, b.model_dump_json())
            for b in buckets
        ]
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT OR REPLACE INTO metric_buckets (experiment_id, elapsed_s, bucket) "
                "VALUES (?, ?, ?)",
                payload,
            )

    def get_buckets(
        self, experiment_id: UUID, *, from_elapsed: float | None = None
    ) -> list[MetricBucket]:
        """Ordered by elapsed ascending — the live chart and phase analysis
        both assume time order; doing it in SQL beats sorting in Python."""
        sql = "SELECT bucket FROM metric_buckets WHERE experiment_id = ?"
        params: list[object] = [str(experiment_id)]
        if from_elapsed is not None:
            sql += " AND elapsed_s >= ?"
            params.append(from_elapsed)
        sql += " ORDER BY elapsed_s"
        rows = self._conn.execute(sql, params).fetchall()
        return [MetricBucket.model_validate_json(r["bucket"]) for r in rows]

    # --- evidence ---------------------------------------------------------------

    def append_evidence(self, experiment_id: UUID, row: Evidence) -> int:
        """Immediate insert (low volume, spec I1). Returns the assigned seq
        (used by report builders to reference rows)."""
        with self._lock, self._conn:
            max_row = self._conn.execute(
                "SELECT COALESCE(MAX(seq), 0) AS m FROM evidence WHERE experiment_id = ?",
                (str(experiment_id),),
            ).fetchone()
            seq = int(max_row["m"]) + 1
            self._conn.execute(
                "INSERT INTO evidence (experiment_id, seq, row) VALUES (?, ?, ?)",
                (str(experiment_id), seq, row.model_dump_json()),
            )
            return seq

    def get_evidence(self, experiment_id: UUID) -> list[Evidence]:
        rows = self._conn.execute(
            "SELECT row FROM evidence WHERE experiment_id = ? ORDER BY seq",
            (str(experiment_id),),
        ).fetchall()
        return [Evidence.model_validate_json(r["row"]) for r in rows]

    # --- phase markers ------------------------------------------------------------

    def mark_phase(self, experiment_id: UUID, name: str, elapsed_s: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO phase_markers (experiment_id, name, elapsed_s) "
                "VALUES (?, ?, ?)",
                (str(experiment_id), name, elapsed_s),
            )

    def get_phase_markers(self, experiment_id: UUID) -> dict[str, float]:
        rows = self._conn.execute(
            "SELECT name, elapsed_s FROM phase_markers WHERE experiment_id = ?",
            (str(experiment_id),),
        ).fetchall()
        return {r["name"]: r["elapsed_s"] for r in rows}

    # --- reports -----------------------------------------------------------------

    def save_report(self, report: Report) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO reports (experiment_id, report) VALUES (?, ?)",
                (str(report.experiment_id), report.model_dump_json()),
            )

    def get_report(self, experiment_id: UUID) -> Report:
        row = self._conn.execute(
            "SELECT report FROM reports WHERE experiment_id = ?", (str(experiment_id),)
        ).fetchone()
        if row is None:
            raise NotFound(f"report for experiment {experiment_id} not found")
        return Report.model_validate_json(row["report"])

    # --- waitlist ----------------------------------------------------------------

    def join_waitlist(self, email: str, plan: str) -> tuple[bool, int]:
        """Add an email; returns (created, position). Joining twice keeps the
        original row and position, so the landing page can say "already in"."""
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO waitlist (email, plan, created_at) VALUES (?, ?, ?)",
                (email, plan, self._now().isoformat()),
            )
            created = cur.rowcount == 1
            position = self._conn.execute(
                "SELECT COUNT(*) FROM waitlist "
                "WHERE rowid <= (SELECT rowid FROM waitlist WHERE email = ?)",
                (email,),
            ).fetchone()[0]
        return created, position

    def waitlist_count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM waitlist").fetchone()[0]
