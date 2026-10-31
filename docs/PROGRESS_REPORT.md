# BlastRadius: Progress Report & Phase Test Guide

> Compares the code in this repo (commit `1555d8b`) against the target spec in `BLASTRADIUS_SPEC.md`, scores how much is done, lists what's left, and explains every phase with the tests to run after it.
> Companion to [PHASE_PLAN.md](PHASE_PLAN.md) (what to build, in what order). This file covers **how far along we are, and how to prove each phase works.**

> ⚠️ **Method:** this is a static audit. I read every source and test file but could not execute them (running code from the cloned repo was blocked in this session). Percentages are estimates of *code completeness*, not verified behaviour. Phase 0's first step is to run the suite and correct these numbers.


> **Superseded in part by [PRD.md](PRD.md):** storage is **PostgreSQL** (not SQLite) in the running app, the AI agent is a core feature, and team ownership is defined in PRD §13. Where they conflict, the PRD wins.

---

## Contents

1. [Headline numbers](#1-headline-numbers)
2. [Spec vs repo: where they differ](#2-spec-vs-repo-where-they-differ)
3. [How the percentage was calculated](#3-how-the-percentage-was-calculated)
4. [Feature-by-feature status](#4-feature-by-feature-status)
5. [Test coverage vs the spec's test matrix](#5-test-coverage-vs-the-specs-test-matrix)
6. [What's left (remaining work)](#6-whats-left-remaining-work)
7. [Testing approach: tiers and the regression rule](#7-testing-approach-tiers-and-the-regression-rule)
8. [Phases explained, with tests after each](#8-phases-explained-with-tests-after-each)
9. [Progress tracker](#9-progress-tracker)

---

## 1. Headline numbers

| Measure | Result |
|---|---|
| **Overall completion (effort-weighted)** | **≈ 45%** |
| Backend / core engine (Modules A, B, C, report, API) | **≈ 78%** |
| User-facing surfaces (CLI + web dashboard) | **0%** |
| Runnable stack (demo app + Docker/packaging) | **≈ 3%** |
| Test matrix T1–T28 covered | **≈ 45%** (≈ 12.5 of 28) |
| Spec status-table rows (24 rows, count-based) | **≈ 35%** |
| P0 + P1 rows only (15 rows, count-based) | **≈ 50%** |
| Demo acts runnable today (of 5) | **0 / 5** |
| Estimated remaining effort to P1 gate (demo-ready) | **≈ 23 person-hours** (≈ 10–12 wall-clock hours with 4 people in parallel) |

**In one sentence:** the analysis core is mostly built and well tested; nothing a judge can *see* exists yet (CLI, dashboard, demo app); and the fault path, the product's differentiator, is currently broken.

```
Overall      █████████░░░░░░░░░░░  45%
Core engine  ████████████████░░░░  78%
Surfaces     ░░░░░░░░░░░░░░░░░░░░   0%
Runnable     █░░░░░░░░░░░░░░░░░░░   3%
Tests        █████████░░░░░░░░░░░  45%
```

---

## 2. Spec vs repo: where they differ

The team's `plan.md` evolved past `BLASTRADIUS_SPEC.md`. Where they differ, **`plan.md` and the code win**. They're newer and already implemented. Differences that affect the work:

| Topic | `BLASTRADIUS_SPEC.md` (my spec) | Repo / `plan.md` | Decision |
|---|---|---|---|
| CLI name | `blastradius` | `br` | **Use `br`** |
| CLI architecture | Thin client only; server required for runs | Standalone (imports `core/` in-process) **or** `--remote URL` | **Use repo's.** Better for CI; safety still enforced because `core/` runs the same preflight |
| Code layout | `backend/app/services`, CLI inside backend | Shared `core/` library + `backend/` + `cli/` | **Use repo's.** Cleaner |
| Live updates | WebSocket | SSE + polling fallback | **SSE.** Already built; all live data is server→client |
| Storage | PostgreSQL | SQLite store (`core/store/sqlite_store.py`) | **SQLite for hackathon**, Postgres later |
| CI exit codes | 0–5 (pass/breach/preflight/abort/config/unreachable) | 0 pass / 1 breach / 2 error | **Use 0/1/2** (simpler); put the detailed reason in `--json` output |
| Gap analysis (missing healthchecks, limits, SPOF) | Not in spec | ✅ Built | **Keep.** Extra value |
| Fix prompt for AI agents | Not in spec | ✅ Built (deterministic) | **Keep.** Strong demo closer |
| Before/after re-test | History compare (P2) | ✅ Compare logic built; re-run flow missing | **Keep, P1** |
| Resilience score 0–100 | Not in spec | ✅ Built | Keep, but it's P2. Don't spend more time on it |
| Test style | pytest | Script-style `main()` with custom `assert_true` | **Problem (see §5.2).** pytest only finds 3 of ~300 checks |

---

## 3. How the percentage was calculated

Each spec area gets a **weight** proportional to its estimated build effort (from the 24-hour plan), so the weights total 100. Each area gets a **completion %** from the code audit, using these rules:

| Evidence in code | Credit |
|---|---|
| Implemented + unit-tested, matches spec | 90–100% |
| Implemented, untested or not wired into the running app | 60–85% |
| Implemented but broken (crashes / doesn't do the thing) | 15–60% depending on how much is salvageable |
| Not present | 0% |

`area points = weight × completion`, and `overall = Σ area points`.

| # | Spec area (`BLASTRADIUS_SPEC.md` §) | Weight | Done | Points | Why |
|---|---|---:|---:|---:|---|
| 1 | Module A: Architecture intelligence (§6) | 10 | 95% | **9.5** | Parser, validation errors, classification, declared + inferred edges, predicted impact all built and tested (≈ 30 checks + API tests) |
| 2 | Module B: Failure simulator (§7) | 15 | 51% | **7.65** | See breakdown ↓ |
| | • Preflight (9 checks) | 4 | 75% | 3.0 | All 9 coded + tested with mocks; live app never passes a Docker client |
| | • Fault inject / restore / watchdog / sweep | 5 | 15% | 0.75 | No Docker client wired, errors swallowed, no label re-check, no watchdog or sweep |
| | • Phases + recovery | 3 | 70% | 2.1 | Logic tested; controller uses scheduled restore time, ignores config |
| | • Evidence attribution | 3 | 60% | 1.8 | Rules tested in isolation; controller calls them with wrong args, so it crashes |
| 3 | Module C: Traffic Twin (§8) | 12 | 88% | **10.5** | See breakdown ↓ |
| | • k6 script generation | 3 | 100% | 3.0 | Open-model template, JSON-escaped, 23 checks |
| | • k6 subprocess runner | 3 | 70% | 2.1 | Code complete; never run against a live target |
| | • Collector, buckets, percentiles | 3 | 90% | 2.7 | Nearest-rank, raw-sample recompute, tested |
| | • SLO breach + breaking point | 2 | 100% | 2.0 | Tested incl. ramp trimming |
| | • Safety auto-stop | 1 | 70% | 0.7 | In controller loop + k6 `abortOnFail`; untested |
| 4 | Report, recommendations, fix prompt, compare (§9, §14.4) | 8 | 90% | **7.2** | Deterministic, byte-identical regeneration tested; confounded-run rule tested |
| 5 | Backend API, SSE, persistence (§10, §11) | 8 | 80% | **6.4** | 15 routes + SSE + SQLite store tested; missing `/api/limits`, `/preflight` re-run, `/rerun` |
| 6 | CLI (§15) | 11 | 0% | **0** | No `cli/` folder |
| 7 | Web dashboard (§14) | 15 | 0% | **0** | No `frontend/` folder |
| 8 | Demo application (§13) | 8 | 5% | **0.4** | Only a compose fixture for tests |
| 9 | Infra & packaging (§19) | 4 | 0% | **0** | No compose, Dockerfile, Makefile, pyproject, env example |
| 10 | Automated tests (§17) | 6 | 45% | **2.7** | ≈ 12.5 of 28 matrix items; no integration, CLI, or frontend tests |
| 11 | P2 extras: bottleneck, resource metrics, Toxiproxy, AI (§8.6, §16) | 3 | 10% | **0.3** | Only the score exists |
| | **Total** | **100** | | **≈ 44.7%** | |

**Grouped:**
- Core engine = areas 1–5 → 41.25 / 53 = **78%**
- Surfaces = areas 6–7 → 0 / 26 = **0%**
- Runnable stack = areas 8–9 → 0.4 / 12 = **3%**

**Cross-check (count-based):** of the 24 rows in `BLASTRADIUS_SPEC.md` §18, 5 are done, 6 partial, 2 broken, 11 not started. Counting done = 1, partial = 0.5, broken = 0.25: (5 + 3 + 0.5) / 24 = **35%**. This is lower than the weighted figure because the many unstarted P2 rows count equally. Restricting to P0 + P1 rows: (4 + 3 + 0.5) / 15 = **50%**.

---

## 4. Feature-by-feature status

Legend: ✅ done · 🟡 partial · 🔴 broken · ❌ not started

### 4.1 Against `BLASTRADIUS_SPEC.md` §18 status table

| Feature | Pri | Status | Evidence in repo | Left to do |
|---|---|---|---|---|
| Compose parser + validation | P0 | ✅ | `core/parser/compose.py`, `test_parser.py` | — |
| Dependency graph (declared + inferred) | P0 | ✅ | `core/graph/*`, `test_graph.py`, API impact tests | — |
| React Flow graph UI | P0 | ❌ | — | Whole Architecture page |
| k6 load runner + hard limits | P0 | 🟡 | `core/load/*`, `core/safety/limits.py` | Live run; remove fake-data fallback (B1) |
| Live latency / error charts | P0 | 🟡 | SSE `backend/app/api/stream.py` | Charts in UI + CLI live view |
| Experiment persistence | P0 | 🟡 | SQLite store, `test_store.py` (24 checks) | Aborted runs not finalised (B6) |
| Basic report | P0 | ✅ | `core/report/builder.py`, `test_report.py` | — |
| Demo app (5 services) | P0 | ❌ | Fixture only | Whole `demo-app/` |
| Preflight safety checks | P1 | 🟡 | `core/safety/preflight.py`, 9 checks tested | Wire real Docker client (B2) |
| Redis stop/restore fault | P1 | 🔴 | `_inject_fault` stub-like | Injector, watchdog, sweep (B2, B4) |
| Phase comparison + recovery time | P1 | 🟡 | `core/analysis/{phases,recovery}.py` | Use actual restore time (B5) |
| Evidence-based impact highlighting | P1 | 🔴 | Rules in `core/analysis/evidence.py` | Fix controller call (B3); UI |
| Load ramp + breaking point | P1 | ✅ | `core/analysis/slo.py`, schedule | Live verification |
| Kill switch + watchdog restore | P1 | 🟡 | API abort | Partial report, watchdog, CLI/UI buttons |
| CLI core | P1 | ❌ | — | Whole `cli/` |
| Run-vs-run comparison | P2 | ✅ | `core/analysis/compare.py`, fairness check tested | Re-run flow + UI |
| CPU / memory via docker stats | P2 | ❌ | — | |
| DB connection / pool diagnostics | P2 | ❌ | — | |
| Bottleneck classification | P2 | ❌ | Schema field only | |
| Latency injection (Toxiproxy) | P2 | ❌ | — | |
| Gemini explanations | P2 | ❌ | — | |
| Prometheus + cAdvisor | P2 | ❌ | — | |
| CLI extras | P2 | ❌ | — | |
| CI example workflow | P2 | ❌ | — | |

### 4.2 Extras built that the spec didn't have

| Extra | Status |
|---|---|
| Compose gap analysis | ✅ `core/graph/gaps.py` |
| Deterministic fix prompt | ✅ `core/report/fix_prompt.py` + API route |
| Resilience score | ✅ `core/report/score.py` |
| Config immutability enforced by a DB trigger | ✅ tested in `test_store.py` |
| Three-layer hard-cap enforcement incl. `model_construct` bypass test | ✅ `test_safety.py` |

---

## 5. Test coverage vs the spec's test matrix

### 5.1 Matrix T1–T28 (`BLASTRADIUS_SPEC.md` §17.1)

| ID | Requirement | Covered? | Where |
|---|---|---|---|
| T1 | Parser reads supported config | ✅ | `test_parser.py`, `test_api.py` (5 nodes) |
| T2 | Short + long `depends_on` | ✅ | `test_parser.py` |
| T3 | Graph relationships, inferred reasons | ✅ | `test_graph.py` |
| T4 | Predicted blast radius | ✅ | `test_api.py` (impact = api, worker, frontend) |
| T5 | Helpful validation errors | ✅ | `test_parser.py`, `test_api.py` |
| T6 | Percentiles correct | ✅ | `test_analysis.py` (1..100 → 50/95/99) |
| T7 | Metrics match k6 results | 🟡 | Buckets tested; `k6parse.py` has no dedicated test |
| T8 | SLO breach detection | ✅ | `test_analysis.py` |
| T9 | Recovery measured, not assumed | ✅ | `test_analysis.py` (incl. timeout, empty buckets) |
| T10 | Hard limits | ✅ | `test_safety.py`, `test_schemas.py`, `test_script.py` |
| T11 | Unauthorised fault targets rejected | 🟡 | Preflight shape tested with mocks; not every rejection case |
| T12 | Load target allowlist | ✅ | `test_safety.py` (metadata IP, public resolve, scheme) |
| T13 | Missing metrics = unavailable | 🟡 | Schema enforces it; no collector-level test |
| T14 | Report from recorded data only | ✅ | `test_report.py`, `test_api.py` byte-identical |
| T15 | Confounded runs flagged | ✅ | `test_report.py` |
| T16 | AI grounding check | ❌ | No AI yet (P2) |
| T17 | Load runner sends real requests | ❌ | Needs demo app |
| T18 | Cancellation works | 🟡 | State → ABORTED tested; k6 process exit not tested |
| T19 | Fault produces measurable impact | ❌ | |
| T20 | Restore + recovery | ❌ | |
| T21 | Abort restores faults | ❌ | |
| T22 | Safety auto-stop | ❌ | |
| T23 | Frontend status badges | ❌ | |
| T24–T28 | CLI tests | ❌ | |

**Score:** 12 ✅ + 4 🟡 (×0.5 = 2) − items that can't be counted yet → ≈ **12.5–14 of 28 ≈ 45–50%**. All of it is unit-level. **Zero integration or end-to-end tests exist.**

### 5.2 Two problems in the existing tests

1. **pytest can't see most tests.** 9 of 10 files are scripts with a `main()` function and custom `assert_true()`; only `test_controller_and_preflight.py` has `test_*` functions. Running `pytest` collects **3 tests** while about **300 checks** exist. CI would report green while skipping almost everything.
   **Fix (Phase 0):** add to each script-style file:
   ```python
   def test_all() -> None:
       assert main() == 0
   ```
2. **The controller test hides bug B3.** `test_controller_and_preflight.py` starts a fault run, then aborts after 1 s, so it never reaches report finalisation, where the `build_evidence()` call crashes.
   **Fix (Phase 0):** add a test that runs a short fault experiment *to completion* (simulated mode) and asserts a report is saved.

### 5.3 Count of existing checks

| File | Checks (approx.) | Area |
|---|---:|---|
| `test_api.py` | 53 | REST routes |
| `test_schemas.py` | ~50 | Pydantic validation |
| `test_analysis.py` | 48 | Percentiles, SLO, phases, recovery, evidence |
| `test_report.py` | 37 | Recommendations, fix prompt, score, compare |
| `test_safety.py` | 33 | Allowlists, IP safety, caps |
| `test_controller_and_preflight.py` | 27 | Preflight, schedule, k6 script, controller start/abort |
| `test_store.py` | 24 | SQLite persistence |
| `test_script.py` | 23 | k6 template |
| `test_graph.py` | 21 | Graph builder |
| `test_parser.py` | ~10 | Parser |
| **Total** | **≈ 325** | |

---

## 6. What's left (remaining work)

Grouped by phase from [PHASE_PLAN.md](PHASE_PLAN.md), with effort and the % it adds to the overall score when done.

| Phase | Remaining work | Effort (person-h) | Adds | Overall after |
|---|---|---:|---:|---:|
| 0 · Stabilise | Bugs B1–B7, pytest collection, full-path controller test | 2 | +3% | 48% |
| 1 · Runnable | `pyproject`, demo app, Dockerfile with k6, compose, Makefile, endpoint map, T17 | 3 | +13% | 61% |
| 2 · Real faults | Injector, watchdog, sweep, Docker wiring, T19–T21 | 3 | +8% | 69% |
| 3 · CLI | `br` (parse, run, report, abort, REPL, confirmations), T24–T28 | 4 | +11% | 80% |
| 4 · Dashboard | Architecture, Live experiment, Traffic Twin, Report pages, T23 | 6 | +15% | 95%* |
| 5 · Close loop | Re-run endpoint, fixed demo variant, before/after view | 2 | +2% | 97%* |
| 7 · Demo hardening | Rehearsal, recorded run, video, README | 3 | — | Demo-ready |
| 6 · P2 polish | Diagnostics, bottleneck, Toxiproxy, AI | Leftover | +3% | 100% |
| **Total to demo-ready (P0 + P1)** | | **≈ 23** | | |

\* Phases 2, 3, and 4 run in parallel, so wall-clock time is shorter than the sum.

---

## 7. Testing approach: tiers and the regression rule

### 7.1 Four test tiers

| Tier | Needs | Speed | Command | When |
|---|---|---|---|---|
| **U · Unit** | Python only | < 10 s | `pytest -q -m "not integration and not e2e"` | Every commit |
| **I · Integration** | Docker + demo stack up | 1–3 min | `pytest -q -m integration` | After each phase from Phase 1 on |
| **E · End-to-end** | Full stack + CLI / browser | 2–5 min | `pytest -q -m e2e` + Playwright | Phases 3, 4, 5, 7 |
| **M · Manual demo check** | Demo laptop | 3 min | Checklist in each phase below | End of every phase |

Markers are registered in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
markers = ["integration: needs docker + demo stack", "e2e: full stack via CLI or browser"]
asyncio_mode = "auto"
```

### 7.2 The regression rule

> **After every phase, run every tier that existed before it, plus the new tests.** A phase isn't done if an older test broke.

```
Phase 0 → U
Phase 1 → U + I(load)
Phase 2 → U + I(load, fault)
Phase 3 → U + I + E(cli)
Phase 4 → U + I + E(cli, web)
Phase 5 → U + I + E(all) + before/after
Phase 7 → everything, 3× in a row on the demo laptop
```

### 7.3 Phase-gate script

Add `scripts/gate.sh` so one command checks a phase:

```bash
./scripts/gate.sh 2
```

It runs the tiers listed for that phase, prints a pass/fail table, and exits non-zero on any failure.

---

## 8. Phases explained, with tests after each

Each phase follows the same structure: **why**, **how it works**, **what gets built**, **tests to add**, **tests to run after**, **manual check**, **done when**.

---

### Phase 0: Stabilise the core

**Why:** the product's promise is "honest numbers or no numbers". Today the controller can invent data and label it `live`, and every fault run crashes before saving a report. Building UI on top of that would display fake or missing results.

**How it works after the fix:**
```
run_experiment()
  ├─ k6 present?  ── no ──▶ --simulate set? ── no ──▶ FAILED "k6 not installed"
  │                               └─ yes ─▶ synthetic samples, data_source="simulated"
  └─ yes ─▶ real k6 samples, data_source="live"
  ...
  finalize: build_evidence(service_endpoints=map, window_start=actual_inject_ts,
                           window_end=actual_restore_ts)
            measure_recovery(restore_elapsed_s=actual_restore_ts,
                             stable_s=cfg.recovery_stable_s, timeout_s=cfg.recovery_timeout_s)
  on cancel: finalize partial report with final_state=ABORTED, then exit
```

**Built:** fixes for B1–B7 (see PHASE_PLAN §2), `data_source` gains `"simulated"`, endpoint→service map field, pytest wrappers, README links.

**Tests to add**

| Test | Asserts |
|---|---|
| `test_no_k6_fails_honestly` | No k6 + no simulate → state `FAILED`, reason contains "k6 not installed", **zero buckets stored** |
| `test_simulated_is_labelled` | `--simulate` run → `report.data_source == "simulated"` |
| `test_fault_run_completes` | Short fault run (3 s / 3 s / 6 s) to completion → state `COMPLETED`, report saved, evidence list non-empty |
| `test_recovery_uses_actual_restore` | Restore delayed 2 s vs schedule → recovery measured from the actual timestamp |
| `test_abort_writes_partial_report` | Abort mid-run → state `ABORTED` and a report exists |
| `test_capacity_has_no_fault_delta` | Capacity run → `baseline_vs_fault is None` |
| `test_all` wrappers | Each script-style file's `main()` returns 0 |

**Run after:**
```bash
pytest -q
```
Expected: ~10 collected test functions wrapping ≈ 330 checks, all passing.

**Manual check:** run a simulated fault experiment via the API; the report JSON shows `"data_source": "simulated"`.

**Done when:** all U tests green, results pasted into README; no code path can produce numbers without k6 unless `--simulate` is explicitly set.

---

### Phase 1: Run it for real (packaging + demo app)

**Why:** every number in the demo must come from real HTTP requests against a real app. That needs a demo app, k6 in a container, and one command to start it all.

**How it works:**
```
make up
  ├─ docker compose -f demo-app/compose.yaml up -d   (network br-target)
  │     demo-frontend · demo-api · demo-redis · demo-postgres · demo-worker
  └─ docker compose up -d                              (control plane, 127.0.0.1 only)
        backend (FastAPI + k6 binary + docker.sock)
k6 ──GET──▶ demo-api:3000/api/* ──▶ redis / postgres
k6 --out json=- ──▶ k6parse ──▶ BucketAggregator ──▶ SQLite + SSE
```
The demo API exposes `/metrics` with a request counter, so tests can confirm that k6's count matches what the app actually received.

**Built:** `pyproject.toml` (with `br` entry point), `demo-app/` (API, worker, frontend, seed SQL, `compose.yaml`, `endpoints.yaml`), `backend/Dockerfile` (pinned k6), root `docker-compose.yml`, `.env.example`, `Makefile`.

**Tests to add**

| ID | Tier | Asserts |
|---|---|---|
| T7 | U | Recorded k6 JSON fixture → `k6parse` → bucket totals equal line counts; non-2xx counted as failures |
| T17 | I | 10 s at 10 RPS → k6 sample count within ±2% of the demo-api `/metrics` counter delta |
| T22 | I | Target `/api/slow?ms=2000`, `max_p95_ms=500` → `AUTO_STOPPED` with a reason |
| `test_demo_health` | I | `/health` returns `{"status":"ok","redis":"ok","db":"ok"}` |
| `test_gap_findings_on_demo` | U | `demo-app/compose.yaml` → ≥ 2 gap findings |

**Run after:**
```bash
make up
```
```bash
pytest -q -m "not e2e"
```

**Manual check:** create a 30 s capacity run (1×, 2×) via `curl`, then fetch its report: request count is non-zero, `data_source` is `live`, p95 values are plausible.

**Done when:** U + I green on the **demo laptop** (Windows + WSL2), not just a dev machine.

---

### Phase 2: Real fault injection + guaranteed restore

**Why:** this is the differentiator. "Stop Redis → see what really breaks → watch it recover" must be real and must **always** leave Redis running.

**How it works:**
```
inject(redis):
  re-check allowlist + labels NOW  → fail? raise, experiment FAILED
  container.stop(timeout=5)        → record actual timestamp
  ledger.add(exp_id, redis)        → ~/.blastradius/faults.json
  watchdog.start(120s cap)

restore(redis):  container.start(); ledger.remove(); watchdog.cancel(); record timestamp

Three independent safety nets:
  1. watchdog timer   2. controller finally   3. startup sweep over the ledger
```
Evidence: during the fault window, error-rate and latency rules run per service, using the endpoint map (`/api/cart/:id → demo-api`). `demo-api` becomes **verified impact** only if a rule fires.

**Built:** `core/faults/injector.py`, `core/faults/watchdog.py`, ledger, startup sweep in the FastAPI lifespan, `docker.from_env()` wiring.

**Tests to add**

| ID | Tier | Asserts |
|---|---|---|
| `test_injector_rechecks_labels` | U (mock Docker) | Label removed between preflight and inject → raises, nothing stopped |
| `test_injector_never_swallows` | U | Docker error on stop → experiment `FAILED`, not "fault injected" |
| `test_watchdog_restores` | U | Fake clock past cap → `start()` called |
| `test_sweep_restores_ledger` | U | Ledger with 1 entry → sweep starts it, ledger empty |
| T11 (full) | U | Unlabelled, `NODE_ENV=production`, not allowlisted, database kind → each fails preflight |
| T19 | I | Stop Redis under 20 RPS → `/api/cart` fault-phase error rate > 50%; evidence row for `demo-api` |
| T20 | I | After restore: Redis running; `recovery_time_s` is a number **or** `recovered=False`, never assumed |
| T21 | I | Abort during fault → Redis running within 10 s |
| `test_crash_recovery` | I | Kill backend mid-fault, restart → Redis restored by sweep |
| `test_products_unaffected` | I | `/api/products` error rate unchanged during Redis fault (no false impact) |

**Run after:**
```bash
pytest -q -m "not e2e"
```
Then the soak test, 10 consecutive fault runs:
```bash
pytest -q -m integration -k test_fault_redis --count 10
```
(uses `pytest-repeat`)

**Manual check:** run a fault experiment and watch `docker ps` in another terminal: Redis disappears at about 20 s and is back at about 40 s.

**Done when:** 10/10 runs end with Redis running, a saved report, and evidence for `demo-api` only.

---

### Phase 3: Premium CLI (`br`)

**Why:** half the product's audience lives in the terminal, and the CLI is the CI story ("fail the build on a resilience regression"). It's also the most memorable live-demo moment if it looks polished.

**How it works:**
```
br (no args) ──▶ REPL (prompt_toolkit) ──▶ /slash commands ─┐
br run x.yaml ─────────────────────────────────────────────┤
                                                            ▼
                                client.py
                 standalone: import core, run controller in-process
                 remote:     REST + SSE to http://127.0.0.1:8000
                                                            ▼
                     render/* (Rich): header · tree · confirm · live · summary
                                                            ▼
                         exit 0 pass · 1 breach / not recovered · 2 error
```
Ctrl+C triggers the same abort path as the API: stop k6, restore faults, write a partial report.

**Built:** `cli/` per [PHASE_PLAN §13](PHASE_PLAN.md#13-premium-cli-design-spec): theme, renderers, REPL, commands.

**Tests to add**

| ID | Tier | Asserts |
|---|---|---|
| T24 | U | `br parse demo-app/compose.yaml --json` equals the `POST /api/architecture/parse` output; bad file → exit 2 with the same error text |
| T25 | U | Mocked outcomes → exit 0 / 1 / 2 as specified |
| T26 | U | Over-cap flags rejected; `br --help` lists no `--force` or `--skip-preflight` |
| `test_json_is_pure` | U | `--json` stdout parses as one JSON document; no ANSI codes |
| `test_no_color` | U | `NO_COLOR=1` output contains glyph **and** word for every state |
| `test_width_80` | U | Renderers fit 80 columns (Rich console `width=80`, no overflow) |
| T27 | E | SIGINT during fault phase → `/abort` path runs, Redis running, exit 2, partial report exists |
| T28 | E | `br run --remote` run appears in `GET /api/experiments` and streams on SSE |
| `test_repl_smoke` | E | Scripted REPL session: `/parse …`, `/status`, `/exit` → no traceback |

**Run after:**
```bash
pytest -q
```
```bash
pytest -q -m e2e -k cli
```

**Manual check (looks matter here):** in Windows Terminal, VS Code terminal, and an 80-column window, run `br`, `/parse`, `/fault demo-redis`, choose "1. Yes", watch the live view, press Ctrl+C once. Screenshot each for the README.

**Done when:** a first-time user goes from `br` to a finished report with no traceback, and CI mode returns correct exit codes.

---

### Phase 4: Web dashboard

**Why:** the graph lighting up *only when evidence arrives* is the visual proof of "evidence over assumption". It's the centrepiece of the pitch.

**How it works:**
```
React (Vite) ──REST──▶ /api/architecture/parse ──▶ React Flow + dagre
             ──REST──▶ POST /api/experiments, /start
             ◀──SSE─── /api/experiments/{id}/stream
                       state · phase · bucket · evidence · report
  bucket   → Recharts series (batched every 500 ms)
  evidence → node status "impact observed" + evidence feed row
  phase    → ReferenceArea bands; breach → ReferenceDot
  SSE error → fall back to polling /samples?from=
```

**Built:** `frontend/` with the Architecture, Experiment (live), Traffic Twin, and Report pages, a typed API client generated from OpenAPI, and status badges.

**Tests to add**

| ID | Tier | Asserts |
|---|---|---|
| T23 | U (Vitest) | Each status renders icon + text + `aria-label`, not colour alone |
| `ServiceNode.test` | U | Node switches to "impact observed" only after an `evidence` event |
| `useExperimentStream.test` | U | SSE error → polling fallback starts |
| `DataSourceBadge.test` | U | `simulated` / `recorded` → visible badge; `live` → none |
| `e2e/architecture.spec` | E (Playwright) | Upload demo compose → 5 nodes, dashed inferred edges, ≥ 2 gap badges |
| `e2e/fault-run.spec` | E | Start fault run → API node shows "impact observed" within the fault window; Redis node "recovered" afterwards |
| `e2e/kill-switch.spec` | E | Click Stop mid-fault → state "aborted"; `docker inspect demo-redis` → running |

**Run after:**
```bash
pytest -q
```
```bash
cd frontend && npm test
```
```bash
cd frontend && npx playwright test
```

**Manual check:** every number on screen can be found in `GET /api/experiments/{id}/samples` or the report JSON. Spot-check 5 numbers.

**Done when:** **P0 gate passed**: upload → graph → load test → live charts → saved report, in both CLI and web.

---

### Phase 5: Close the loop (fix prompt + before/after)

**Why:** a report alone isn't actionable. The fix prompt gives the user (or their AI agent) the next step, and the re-test proves the fix worked under identical conditions.

**How it works:**
```
Report ──▶ fix_prompt (deterministic template, numbers only from report)
user applies fix  (demo: CART_REDIS_FALLBACK=1 on demo-api)
POST /api/experiments/{id}/rerun ──▶ clone config verbatim, compared_to=id, full preflight
compare(before, after) ──▶ deltas + fairness check (same limits + same load config)
```

**Built:** `/rerun` route, fixed-variant toggle in the demo app, Before/After page, `br compare`.

**Tests to add**

| Test | Tier | Asserts |
|---|---|---|
| `test_rerun_clones_config` | U | Rerun config == original config byte-for-byte; `compared_to` set |
| `test_rerun_runs_preflight` | U | Rerun with a now-unlabelled container → `PREFLIGHT_FAILED` |
| `test_fix_prompt_numbers_grounded` | U | Every number in the prompt appears in the report JSON |
| `test_before_after_improves` | I | Redis fault before fix: `/api/cart` errors > 50%; after `CART_REDIS_FALLBACK=1`: < 5%; fairness warning absent |
| `e2e/before-after.spec` | E | Before/After page shows both runs and the deltas |

**Run after:** the full suite (U + I + E), then the whole demo loop once end to end.

**Done when:** **P1 gate passed**: map → break → recover → ramp → report → fix prompt → re-test shows a measured improvement. **Feature freeze starts here.**

---

### Phase 6: Diagnostics & polish (P2, optional)

**Why:** this turns "it broke at 5×" into "it broke at 5× **because** the DB pool ran out". It's valuable, but only once everything above is solid.

**How it works:** sample `docker stats` and the demo API's `/metrics` pool gauges every 2 s into `OptionalMetric` series, then evaluate ordered bottleneck rules at the first breach (`load_generator_limited` → `db_connection_exhaustion` → `cpu_bound` → `memory_pressure` → `downstream_latency` → `unknown`).

**Tests to add:** one unit test per bottleneck rule with synthetic series; `unknown` when signals are missing (report lists which ones); T16 AI grounding (invented number → summary rejected); integration: ramp to the pool limit → `db_connection_exhaustion` with `pg_pool_waiting > 0`.

**Run after:** the full suite. Any P2 feature that makes an older test fail gets cut, not patched at the last minute.

---

### Phase 7: Demo hardening & freeze

**Why:** a live demo fails in ways tests don't catch: Wi-Fi, Docker Desktop, terminal fonts, timing.

**Steps and checks**

| Check | How | Pass when |
|---|---|---|
| Full regression ×3 | `./scripts/gate.sh all` three times in a row | 3/3 green |
| Timed rehearsal ×3 | Run the 3-minute script with a stopwatch | ≤ 3:00 each time |
| Offline | Wi-Fi off → `make down && make up` → full demo | Works (images pre-pulled) |
| Recorded fallback | Load the stored recorded run | `RECORDED` badge visible in CLI **and** web |
| Restore paranoia | After every rehearsal: `docker ps` | All 5 demo services running |
| Backup video | Screen recording of a clean run | File saved locally and on a USB stick |
| README honesty | Status table updated: implemented / tested / simulated / planned | Matches reality |

**Done when:** three clean rehearsals in a row on the demo laptop.

---

## 9. Progress tracker

Update as phases finish. Paste real test output next to each row.

| Phase | Status | U tests | I tests | E tests | Overall % | Date | Notes |
|---|---|---|---|---|---:|---|---|
| Audit (now) | — | not run (blocked) | none exist | none exist | ≈ 45 | 2026-10-30 | Static audit only |
| 0 · Stabilise | ☐ | | — | — | 48 | | |
| 1 · Runnable | ☐ | | | — | 61 | | |
| 2 · Real faults | ☐ | | | — | 69 | | |
| 3 · CLI | ☐ | | | | 80 | | |
| 4 · Dashboard | ☐ | | | | 95 | | P0 gate |
| 5 · Close loop | ☐ | | | | 97 | | P1 gate → freeze |
| 6 · P2 | ☐ | | | | 100 | | Optional |
| 7 · Demo-ready | ☐ | | | | — | | 3× clean rehearsals |
