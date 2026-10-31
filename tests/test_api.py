# =============================================================================
# API tests — run: python tests/test_api.py
# =============================================================================
# App under test: in-memory store + injected fakes for every external seam
# (preflight, controller start/abort, reset). The ROUTES are real. Key rules
# under test:
#   - 422 = malformed request (Pydantic field paths in detail)
#   - preflight failure = 200 + PREFLIGHT_FAILED + full checklist (not 422)
#   - 409 = illegal lifecycle transition, 501 = seam not wired (honest)
#   - SSE: correct framing, thread-safe publish, unsubscribe on disconnect
# =============================================================================

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.state import AppState
from core.store import Store
from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentState,
    ExperimentType,
    FaultConfig,
    FaultKind,
    LoadConfig,
    PreflightCheck,
    PreflightResult,
)
from core.schemas.metrics import (
    Evidence,
    EvidenceKind,
    MetricBucket,
    MetricStatus,
    OptionalMetric,
    PhaseStats,
)
from core.schemas.report import Report

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
    state = {"t": T0}

    def _now() -> datetime:
        state["t"] += timedelta(seconds=1)
        return state["t"]

    return _now


PREFLIGHT_PASS = PreflightResult(
    passed=True,
    checks=[PreflightCheck(id="env-label", label="env is labeled test",
                           passed=True, detail="label 'test' found")],
)
PREFLIGHT_FAIL = PreflightResult(
    passed=False,
    checks=[
        PreflightCheck(id="env-label", label="env is labeled test",
                       passed=False, detail="no test label"),
        PreflightCheck(id="production-guard", label="not production",
                       passed=True, detail="env 'test'"),
    ],
)


def make_config(name: str = "exp", *, exp_type: ExperimentType = ExperimentType.CAPACITY,
                baseline_rps: int = 20) -> ExperimentCreate:
    is_fault = exp_type != ExperimentType.CAPACITY
    return ExperimentCreate(
        name=name,
        type=exp_type,
        load=LoadConfig(
            target_base_url="http://demo-api:3000",
            endpoints=["/api/cart", "/health"],
            baseline_rps=baseline_rps,
            multipliers=[1.0] if is_fault else [1, 2, 5],
            # FAULT: load ≥ timeline (20+20+60) — validator-enforced.
            step_duration_s=100 if is_fault else 20,
            ramp_s=0 if is_fault else 5,
        ),
        fault=FaultConfig(kind=FaultKind.STOP_CONTAINER, target_service="demo-redis")
        if is_fault else None,
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


def make_report(exp_id: UUID, *, p95: float = 450.0,
                baseline_rps: int = 20) -> Report:
    return Report(
        experiment_id=exp_id,
        generated_at=T0,
        config=make_config(baseline_rps=baseline_rps),
        final_state=ExperimentState.COMPLETED,
        phases=[
            PhaseStats(
                phase="fault", load_multiplier=1.0,
                start=T0, end=T0 + timedelta(seconds=20),
                requests=400, error_rate=0.5, rps=20.0,
                p50_ms=60.0, p95_ms=p95,
                p99_ms=OptionalMetric(value=None, status=MetricStatus.UNAVAILABLE, reason="no samples"),
                max_ms=900.0, slo_breaches=["p95"],
            )
        ],
        evidence=[Evidence(
            service="demo-api", kind=EvidenceKind.REQUEST_ERRORS,
            metric="error_rate:/api/cart", baseline_value=0.0, observed_value=0.75,
            window_start=T0, window_end=T0, sample_count=40, detail="0% → 75%",
        )],
        affected_services=["demo-api"],
        recovered=True,
        recovery_time_s=2.0,
    )


class Harness:
    """One app + store + fakes. `preflight_result` toggles pass/fail;
    `wired=False` leaves controller seams None (→ 501 paths)."""

    def __init__(self, *, preflight_pass: bool = True, wired: bool = True):
        self.store = Store(":memory:", now_fn=clock())
        self.preflight_result = PREFLIGHT_PASS if preflight_pass else PREFLIGHT_FAIL

        def fake_preflight(exp: ExperimentCreate) -> PreflightResult:
            return self.preflight_result

        def fake_start(exp_id: UUID) -> None:
            self.store.set_experiment_state(
                exp_id, ExperimentState.RUNNING,
                started_at=datetime.now(timezone.utc),
            )

        def fake_abort(exp_id: UUID) -> None:
            self.store.set_experiment_state(
                exp_id, ExperimentState.ABORTED,
                ended_at=datetime.now(timezone.utc),
                stop_reason="aborted by user",
            )

        def fake_reset() -> dict:
            return {"restored_containers": 0, "lock_cleared": True}

        self.state = AppState(
            store=self.store,
            preflight=fake_preflight,
            start_experiment=fake_start if wired else None,
            abort_experiment=fake_abort if wired else None,
            reset_system=fake_reset if wired else None,
        )
        self.client = TestClient(create_app(self.state))

    def create(self, config: ExperimentCreate | None = None) -> dict:
        r = self.client.post("/api/experiments",
                             json=(config or make_config()).model_dump(mode="json"))
        assert r.status_code == 200, r.text
        return r.json()


def main() -> int:
    compose_text = (FIXTURES / "demo-compose.yaml").read_text(encoding="utf-8")

    # =========================================================================
    # architecture: parse / get / impact
    # =========================================================================
    h = Harness()
    r = h.client.get("/api/system/health")
    assert_true("health endpoint", r.status_code == 200 and r.json()["status"] == "ok")

    r = h.client.post("/api/architecture/parse",
                      json={"content": compose_text, "filename": "demo-compose.yaml"})
    assert_true("parse demo compose → 200", r.status_code == 200, r.text[:200])
    graph = r.json()
    assert_true("parsed graph has 5 nodes", len(graph["nodes"]) == 5,
                f"got {len(graph.get('nodes', []))}")
    assert_true("parsed graph has 7 edges", len(graph["edges"]) == 7,
                f"got {len(graph.get('edges', []))}")
    assert_true("gap findings present", len(graph["gaps"]) >= 1)
    gid = graph["id"]

    r = h.client.get(f"/api/architecture/{gid}")
    assert_true("GET graph roundtrip", r.status_code == 200 and r.json() == graph)

    r = h.client.get(f"/api/architecture/{uuid4()}")
    assert_true("GET unknown graph → 404", r.status_code == 404)

    r = h.client.post("/api/architecture/parse", json={"content": "services: [unclosed"})
    assert_true("invalid YAML → 422", r.status_code == 422)
    assert_true("422 detail carries parse message",
                "line" in json.dumps(r.json()).lower(),
                f"got {r.json()}")

    r = h.client.post("/api/architecture/parse", json={"content": ""})
    assert_true("empty content → 422 (field validation)",
                r.status_code == 422)

    r = h.client.get(f"/api/architecture/{gid}/impact/demo-redis")
    assert_true("impact of demo-redis → 200", r.status_code == 200, r.text[:200])
    impacted = sorted(p["impacted_service"] for p in r.json()["impact"]["impacted"])
    assert_true("impact = api, worker, frontend (no network)",
                impacted == ["demo-api", "demo-frontend", "demo-worker"],
                f"got {impacted}")
    used = r.json()["impact"]["edge_sources_used"]
    assert_true("default impact excludes network source",
                "inferred:network" not in used, f"got {used}")

    r = h.client.get(f"/api/architecture/{gid}/impact/demo-redis?include_network=true")
    used_net = r.json()["impact"]["edge_sources_used"]
    assert_true("include_network=true adds network source",
                "inferred:network" in used_net, f"got {used_net}")

    r = h.client.get(f"/api/architecture/{gid}/impact/nope")
    assert_true("unknown service → 404", r.status_code == 404)

    # =========================================================================
    # experiments: create / validation / lifecycle
    # =========================================================================
    h2 = Harness(preflight_pass=True)
    created = h2.create()
    assert_true("create passes preflight → PENDING",
                created["state"] == "pending", f"got {created}")
    assert_true("create returns preflight checks",
                created["preflight"]["passed"] is True)
    exp_id = created["id"]

    bad = make_config("bad-endpoint").model_dump(mode="json")
    bad["load"]["endpoints"] = ["notapath"]
    r = h2.client.post("/api/experiments", json=bad)
    assert_true("endpoint path violation → 422", r.status_code == 422)
    detail = r.json()["detail"]
    # Model-level validator: loc points at ['body','load'] (the enclosing
    # model) and the msg names the offending endpoint — both are "field
    # paths" in FastAPI's 422 contract.
    assert_true("422 detail carries field path + offending value",
                any("load" in str(e.get("loc", "")) for e in detail)
                and "notapath" in json.dumps(detail),
                f"got {detail}")

    bad2 = make_config("no-fault", exp_type=ExperimentType.FAULT).model_dump(mode="json")
    bad2["fault"] = None
    r = h2.client.post("/api/experiments", json=bad2)
    assert_true("fault type without fault config → 422", r.status_code == 422)

    # preflight failure path
    h_fail = Harness(preflight_pass=False)
    failed = h_fail.create()
    assert_true("failed preflight → 200 with PREFLIGHT_FAILED",
                failed["state"] == "preflight_failed", f"got {failed}")
    assert_true("failed preflight returns failed checks",
                failed["preflight"]["passed"] is False
                and len(failed["preflight"]["checks"]) == 2)

    # lifecycle guards
    r = h2.client.post(f"/api/experiments/{exp_id}/start")
    assert_true("start from PENDING → 200 running",
                r.status_code == 200 and r.json()["state"] == "running",
                f"got {r.status_code} {r.json()}")
    r = h2.client.post(f"/api/experiments/{exp_id}/start")
    assert_true("second start → 409", r.status_code == 409)
    r = h2.client.post(f"/api/experiments/{exp_id}/abort")
    assert_true("abort running → 200 aborted",
                r.status_code == 200 and r.json()["state"] == "aborted")
    r = h2.client.post(f"/api/experiments/{exp_id}/abort")
    assert_true("abort again → 409", r.status_code == 409)

    fid = h_fail.create()["id"]
    r = h_fail.client.post(f"/api/experiments/{fid}/start")
    assert_true("start after failed preflight → 409", r.status_code == 409)

    r = h2.client.post(f"/api/experiments/{uuid4()}/start")
    assert_true("start unknown id → 404", r.status_code == 404)

    # Bare-id route is GET-only (POST /api/experiments/{id} doesn't exist),
    # so the uuid-parse check goes through GET.
    r = h2.client.get("/api/experiments/not-a-uuid")
    assert_true("non-uuid path param → 422", r.status_code == 422,
                f"got {r.status_code}")

    # 501: unwired controller
    h501 = Harness(preflight_pass=True, wired=False)
    e501 = h501.create()["id"]
    r = h501.client.post(f"/api/experiments/{e501}/start")
    assert_true("unwired start seam → 501 with honest detail",
                r.status_code == 501 and "not wired" in r.json()["detail"],
                f"got {r.status_code} {r.json()}")

    # list + get
    r = h2.client.get("/api/experiments")
    assert_true("list returns experiments", r.status_code == 200 and len(r.json()) >= 1)
    r = h2.client.get(f"/api/experiments/{exp_id}")
    assert_true("get experiment echoes config + state",
                r.status_code == 200 and r.json()["state"] == "aborted"
                and r.json()["config"]["name"] == "exp",
                f"got {r.json().get('state')}")

    # =========================================================================
    # samples
    # =========================================================================
    h2.store.save_buckets(UUID(exp_id), [bucket(0), bucket(1), bucket(2)])
    r = h2.client.get(f"/api/experiments/{exp_id}/samples")
    assert_true("samples → 200 ordered",
                r.status_code == 200 and [b["elapsed_s"] for b in r.json()] == [0.0, 1.0, 2.0])
    r = h2.client.get(f"/api/experiments/{exp_id}/samples?from=2")
    assert_true("samples ?from filter",
                len(r.json()) == 1 and r.json()[0]["elapsed_s"] == 2.0)
    r = h2.client.get(f"/api/experiments/{uuid4()}/samples")
    assert_true("samples unknown experiment → 404", r.status_code == 404)

    # =========================================================================
    # reports: get / fix-prompt / compare
    # =========================================================================
    r = h2.client.get(f"/api/reports/{uuid4()}")
    assert_true("unknown report → 404", r.status_code == 404)

    rid_a = uuid4()
    report_a = make_report(rid_a, p95=450.0)
    h2.store.save_report(report_a)
    r = h2.client.get(f"/api/reports/{rid_a}")
    assert_true("stored report → 200 byte-identical",
                r.status_code == 200 and r.json() == report_a.model_dump(mode="json"))

    r = h2.client.get(f"/api/reports/{rid_a}/fix-prompt")
    fp = r.json()["fix_prompt"]
    assert_true("fix-prompt route returns markdown with sections",
                r.status_code == 200 and "GOAL:" in fp and "FIX THESE" in fp,
                f"got {fp[:120]}")
    assert_true("fix-prompt grounds in stored evidence",
                "0% → 75%" in fp or "error_rate" in fp, f"got {fp[:300]}")

    rid_b = uuid4()
    report_b = make_report(rid_b, p95=150.0)
    report_b = report_b.model_copy(update={"config": make_config(baseline_rps=100)})
    h2.store.save_report(report_b)

    r = h2.client.post(f"/api/reports/compare?a={rid_a}&b={rid_b}")
    assert_true("compare → 200 with fairness warning (configs differ)",
                r.status_code == 200 and r.json()["fairness_warning"] is not None
                and "baseline_rps" in r.json()["fairness_warning"],
                f"got {r.json().get('fairness_warning')}")

    rid_c = uuid4()
    h2.store.save_report(make_report(rid_c, p95=150.0))
    r = h2.client.post(f"/api/reports/compare?a={rid_a}&b={rid_c}")
    body = r.json()
    assert_true("fair compare → no warning, p95 delta -300",
                body["fairness_warning"] is None and body["deltas"]["p95_ms"] == -300.0,
                f"got {body['fairness_warning']} / {body['deltas']['p95_ms']}")
    assert_true("slo flags computed",
                body["slo_before_passed"] is False and body["slo_after_passed"] is False)

    r = h2.client.post(f"/api/reports/compare?a={rid_a}&b={uuid4()}")
    assert_true("compare with missing report → 404", r.status_code == 404)
    # NOTE: GET /api/reports/compare would be caught by the GET /{report_id}
    # catch-all (422 bad uuid), so the 405 check uses a real report id with
    # a wrong method — path matches, method doesn't.
    r = h2.client.put(f"/api/reports/{rid_c}")
    assert_true("PUT on report route → 405", r.status_code == 405,
                f"got {r.status_code}")

    # =========================================================================
    # system reset
    # =========================================================================
    r = h2.client.post("/api/system/reset")
    assert_true("reset (wired) → 200 summary", r.status_code == 200)
    h_no_reset = Harness(wired=False)
    r = h_no_reset.client.post("/api/system/reset")
    assert_true("reset (unwired) → 501", r.status_code == 501)

    # =========================================================================
    # SSE stream
    # =========================================================================
    h_sse = Harness()
    sid = h_sse.create()["id"]
    with h_sse.client.stream("GET", f"/api/experiments/{sid}/stream") as resp:
        assert_true("stream status + content-type",
                    resp.status_code == 200
                    and resp.headers["content-type"].startswith("text/event-stream"),
                    f"got {resp.status_code} {resp.headers.get('content-type')}")
        h_sse.state.broadcaster.publish(
            "bucket", {"elapsed_s": 1, "phase": "baseline", "p95_ms": 120.0}
        )
        lines: list[str] = []
        for line in resp.iter_lines():
            lines.append(line)
            if line.startswith("data:"):
                break
    assert_true("SSE frame: event line then data line",
                len(lines) >= 2 and lines[0] == "event: bucket"
                and lines[1].startswith("data: "),
                f"got {lines[:3]}")
    parsed = json.loads(lines[1][len("data: "):])
    assert_true("SSE data payload parses with expected fields",
                parsed["phase"] == "baseline" and parsed["p95_ms"] == 120.0,
                f"got {parsed}")

    # disconnect → unsubscribe (poll: server-side finally runs async)
    deadline = time.time() + 3.0
    while h_sse.state.broadcaster.subscriber_count > 0 and time.time() < deadline:
        time.sleep(0.05)
    assert_true("client disconnect unsubscribes (no queue leak)",
                h_sse.state.broadcaster.subscriber_count == 0,
                f"count={h_sse.state.broadcaster.subscriber_count}")

    r = h_sse.client.get(f"/api/experiments/{uuid4()}/stream")
    assert_true("stream unknown experiment → 404", r.status_code == 404)

    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
