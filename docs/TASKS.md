# BlastRadius: Tasks per Team Member

> Derived from [PRD.md](PRD.md) §8 (requirements), §10 (API contract), §13 (ownership), and §14 (timeline).
> Tick a box only when its **Done when** check passes. Hours are from the start of the hackathon.

| Member | Area | Task IDs |
|---|---|---|
| **Ayush** | Backend engine + Gemini agent | AY-01 … AY-14 |
| **Yash** | Backend platform, CLI, Docker, frontend–backend connection | YA-01 … YA-16 |
| **Sanchi** | Frontend: shell, design system, Architecture, Report, Before/After | SA-01 … SA-10 |
| **Harshit** | Frontend: live experiment, Capacity, agent chat | HA-01 … HA-10 |
| **Everyone** | Demo & rehearsal | ALL-01 … ALL-05 |

**Checkpoints:** CP-A (hour 5) real k6 run → saved report · CP-B (hour 9) P0 gate in web + CLI · CP-C (hour 16) full loop incl. agent → **feature freeze**.

---

## Ayush: backend engine + agent

Folders: `core/` (controller, faults, metrics, analysis, store), `core/agent/`, `backend/app/api/agent.py`

| ✓ | ID | Hour | Task | PRD ref | Done when |
|---|---|---|---|---|---|
| ☐ | AY-01 | 0–1 | **Stop fake data (B1):** missing k6 → `FAILED` "k6 not installed"; simulation only with explicit `simulate=True`, report `data_source="simulated"` (add to schema) | FR-C6 | `test_no_k6_fails_honestly`, `test_simulated_is_labelled` pass |
| ☐ | AY-02 | 1–2 | **Fix evidence crash (B3):** pass `service_endpoints`, `window_start`, `window_end` to `build_evidence()`; add `service_endpoints` to the experiment config | FR-B6 | `test_fault_run_completes`: short fault run → `COMPLETED` + report saved |
| ☐ | AY-03 | 1–2 | **Pytest wrappers (B10):** add `def test_all(): assert main() == 0` to every script-style test file | — | `pytest -q` collects all files; all green; paste output in PR |
| ☐ | AY-04 | 2–4 | **Real fault injector (B2, B4):** `core/faults/injector.py`: re-check allowlist + labels at call time, `stop(timeout=5)`, record actual timestamp, raise on failure (no `except: pass`), fault ledger `~/.blastradius/faults.json` | FR-B2 | `test_injector_rechecks_labels`, `test_injector_never_swallows` pass |
| ☐ | AY-05 | 4–5 | **Guaranteed restore:** watchdog (≤ 120 s), controller `finally`, startup sweep over the ledger; wire `docker.from_env()` in `create_live_state` | FR-B3 | `test_watchdog_restores`, `test_sweep_restores_ledger`; kill backend mid-fault → restart → Redis running |
| ☐ | AY-06 | 4–5 | **Recovery + abort (B5, B6, B7):** use actual restore time and config `stable_s` / `timeout_s`; abort writes a partial `ABORTED` report; `baseline_vs_fault` only for fault runs | FR-B4, B5, C7 | `test_recovery_uses_actual_restore`, `test_abort_writes_partial_report`, `test_capacity_has_no_fault_delta` |
| ☐ | AY-07 | 5–7 | **PostgresStore:** `core/store/postgres_store.py`, same interface as `SQLiteStore`, `schema.sql` run at startup, config-immutability trigger, `psycopg` 3 | §11 | `test_store.py` passes against both SQLite and Postgres |
| ☐ | AY-08 | 7–8 | **Statistical evidence:** `core/analysis/stats.py`: two-proportion z-test (errors), Mann–Whitney U (latency); evidence requires p < 0.01 + min effect size | FR-B6 | `test_ztest_known_values`, `test_mannwhitney_no_effect` |
| ☐ | AY-09 | 8–9 | **Live SSE events:** emit `evidence` during the run and `breach` at the first SLO breach | §10.3 | Frontend receives both on a live run (with Yash, C3) |
| ☐ | AY-10 | 9–11 | **Agent tools:** the 9 tools in PRD §9.3 with Pydantic args; `propose_experiment` runs validation + preflight but never starts | FR-G1, §9.3 | Unit test per tool with a fake store |
| ☐ | AY-11 | 11–13 | **Agent loop + API:** Gemini function calling, max 6 steps, `POST /api/agent/chat` (SSE events §10.4), `/actions/{id}/confirm`, `/cancel`, `GET /api/agent/status`; conversations + actions in Postgres | FR-G1, G2 | Hand off to Harshit + Yash (**H6, hour 13**) |
| ☐ | AY-12 | 13–15 | **Grounding verifier:** extract numbers, match against tool outputs, citations, one retry, safe fallback | FR-G3, §9.4 | `test_grounding_rejects_invented_number` |
| ☐ | AY-13 | 13–16 | **Edge cases E1–E14** with a fake Gemini client (scripted) | FR-G4, §9.5 | All 11 agent tests in PRD §15 pass |
| ☐ | AY-14 | 15–16 | **Re-run endpoint:** `POST /api/experiments/{id}/rerun`: clone config, `compared_to`, full preflight | FR-D3 | `test_rerun_clones_config`, `test_rerun_runs_preflight` |
| ☐ | (P2) | 16+ | Right-sizing calculation (`core/analysis/rightsize.py`) | FR-D5 | Only if CP-C passed |

**Ayush depends on:** Yash for the demo app + `endpoints.yaml` (H4, hour 5) and for the Postgres container in compose.
**Ayush hands over:** H3 (hour 3) Phase 0 fixes merged · H5 (hour 9) live `evidence`/`breach` events · H6 (hour 13) agent endpoints.

---

## Yash: backend platform, CLI, Docker, connection

Folders: `cli/`, `demo-app/`, `docker-compose.yml`, `backend/Dockerfile`, `Makefile`, `pyproject.toml`, `.github/workflows/`, API glue, `frontend/src/api/` (types + mocks)

| ✓ | ID | Hour | Task | PRD ref | Done when |
|---|---|---|---|---|---|
| ☐ | YA-01 | 0–1 | **Repo setup:** `pyproject.toml` (deps, `br` entry point, pytest markers `integration` / `e2e`), branch rules, PR template | FR-I5 | `pip install -e .` gives a `br` command |
| ☐ | YA-02 | 1–2 | **Freeze the API contract:** walk the team through PRD §10; agree on event shapes | §10 | Everyone confirms in chat (**H1, hour 2**) |
| ☐ | YA-03 | 2–3 | **Types + mocks for frontend:** `openapi-typescript` → `frontend/src/api/schema.d.ts`; recorded JSON fixtures (graph, buckets, report, agent events) in `frontend/src/mocks/` | §10.1 | Sanchi + Harshit build against mocks (**H2, hour 3**) |
| ☐ | YA-04 | 2–5 | **Demo app:** Express API (`/health`, `/health/live`, `/api/products`, `/api/cart/:id`, `/api/checkout-preview`, `/api/products-cached`, `/api/slow`, `/metrics`), Redis, Postgres (synthetic seed), worker, tiny frontend; labels; `PG_POOL_MAX=10` | FR-I1 | `curl 127.0.0.1:3000/health` → all ok |
| ☐ | YA-05 | 4–5 | **Endpoint map:** `demo-app/endpoints.yaml` (endpoint → service) | FR-I2 | Handed to Ayush (**H4, hour 5**) |
| ☐ | YA-06 | 3–5 | **Docker:** `backend/Dockerfile` with pinned k6; root `docker-compose.yml` (backend, Postgres, frontend; all on `127.0.0.1`); `.env.example` (no real secrets) | FR-I3 | `make up` starts everything on the demo laptop |
| ☐ | YA-07 | 4–5 | **Makefile:** `up`, `down`, `demo`, `test`, `test-integration`, `reset` | FR-I4 | Each target works |
| ☐ | YA-08 | 5–6 | **k6 parity integration test (T17):** 10 s at 10 RPS → k6 count within ±2% of demo `/metrics` counter | PROGRESS §8 | Passes; checks **CP-A** with Ayush |
| ☐ | YA-09 | 5–7 | **CLI core:** `cli/` skeleton, theme (palette + glyphs), `br parse <file> [--json]` | FR-L1 | `br parse demo-app/compose.yaml` shows tree + gaps |
| ☐ | YA-10 | 7–9 | **`br run` + `br report`:** live view (phase bar, metrics, sparklines, service states), summary card, exit codes 0/1/2, `--json`, `--plain`, `--remote`, Ctrl+C → abort + restore spinner; `br report --md --fix-prompt` | FR-L2, L3, C7 | Runs end to end; **CP-B** in CLI |
| ☐ | YA-11 | 9–10 | **API glue:** `GET /api/system/limits`, CORS for `:5173`, regenerate TS types after new endpoints | §10.2 | Frontend calls work without CORS errors |
| ☐ | YA-12 | 10–13 | **CLI REPL:** `br` with no args → welcome panel, slash commands, numbered confirmation menu before faults, status bar; `br abort`, `reset`, `status`, `history`, `compare` | FR-L4, L5 | First-time user gets from `br` to a report with no traceback |
| ☐ | YA-13 | 13–14 | **`br ask "…"` / `/ask`:** agent from the terminal, plan confirmation via keypress | FR-G6 | Same agent flow as the web |
| ☐ | YA-14 | 13–15 | **Demo fix switch:** `CART_REDIS_FALLBACK=1` in the demo API (before/after story) + `experiments/redis-fault.yaml`, `capacity-ramp.yaml` | FR-I1 | Fault run with fallback → cart errors drop |
| ☐ | YA-15 | 14–15 | **CI:** GitHub Actions running unit tests on push | FR-I6 | Green badge on README |
| ☐ | YA-16 | 16–18 | **Connection checklist C1–C8** end to end (PRD §10.5) | §10.5 | All 8 green (**H9, hour 16**) |
| ☐ | (P1) | 16–20 | CLI tests: exit codes, `--json` purity, `NO_COLOR`, 80 columns, Ctrl+C restore | PROGRESS §8 Phase 3 | T24–T28 pass |
| ☐ | (P1) | 20–24 | README final: setup steps, test results pasted, honest status table; recorded fallback run (`data_source="recorded"`) | §15 | README matches reality |

**Yash depends on:** Ayush for honest controller (H3) and agent endpoints (H6).
**Yash hands over:** H1 contract · H2 types + mocks · H4 demo app · H9 connection checklist.

---

## Sanchi: frontend structure & analysis pages

Folder: `frontend/` (shell, design system, `pages/Architecture`, `pages/Report`, `pages/BeforeAfter`, `pages/History`)

| ✓ | ID | Hour | Task | PRD ref | Done when |
|---|---|---|---|---|---|
| ☐ | SA-01 | 0–2 | **Scaffold:** Vite + React + TS + Tailwind; routing; `VITE_API_URL` env | FR-W1 | `npm run dev` serves on `:5173` |
| ☐ | SA-02 | 2–4 | **Design system:** dark theme tokens, typography (Inter + JetBrains Mono), `StatusBadge` (icon + text + colour for healthy / under test / fault injected / impact observed / recovered / unverified), `DataSourceBadge` (`LIVE` / `SIMULATED` / `RECORDED`), `MetricTile` | FR-W1 | Shared with Harshit (**H7, hour 4**) |
| ☐ | SA-03 | 3–5 | **App shell:** nav, API health dot (`/api/system/health`), **global Stop button** (calls `/abort` when a run is active) | FR-W1, §10.5 C1 | Health dot green with backend up |
| ☐ | SA-04 | 4–6 | **Architecture: upload:** paste/upload YAML → `POST /api/architecture/parse`; inline errors with line numbers | FR-W2 | Bad YAML shows the exact parser message |
| ☐ | SA-05 | 6–9 | **Architecture: graph:** React Flow + dagre; edges solid (declared) / dashed (inferred) / amber (verified); red dashed gap badges; legend; uncertainty banner | FR-W2 | Demo compose → 5 nodes, inferred worker edges dashed (**CP-B**) |
| ☐ | SA-06 | 8–10 | **Inspector panel:** kind, deps, dependents, predicted radius (`/impact/{service}`) with paths, verified impacts with evidence links, gaps, "Run experiment on this" (disabled unless fault-allowed) | FR-W2 | Click Redis → predicted radius = api, worker, frontend |
| ☐ | SA-07 | 9–12 | **Report page:** phase table, verified vs predicted-not-observed, recovery, capacity range, limitations + missing metrics, recommendations, **fix-prompt panel with Copy**, **Re-run** button | FR-W5 | Copy puts the exact prompt on the clipboard |
| ☐ | SA-08 | 12–15 | **Before/After page:** two runs side by side (`POST /api/reports/compare`), deltas with arrows **and** words, fairness warning | FR-W6 | Shows real deltas from two runs |
| ☐ | SA-09 | 15–18 | **Accessibility + polish:** `aria-label` on nodes, keyboard focus, empty/loading/error states | §12 | Tab through the main flow works |
| ☐ | SA-10 | 18–20 | **(P2) History page:** list runs with state, type, date, result | FR-W8 | Only if CP-C passed |

**Sanchi depends on:** Yash for types + mocks (H2); Harshit's `useExperimentStream` hook (H8) for the Report's live state.
**Sanchi hands over:** H7 design tokens and badges (hour 4).

---

## Harshit: frontend live & AI pages

Folder: `frontend/` (`pages/Experiment`, `pages/Capacity`, `components/agent/`, `hooks/useExperimentStream`, `hooks/useAgentChat`)

| ✓ | ID | Hour | Task | PRD ref | Done when |
|---|---|---|---|---|---|
| ☐ | HA-01 | 0–3 | **SSE hook:** `useExperimentStream(id)`: `EventSource` on `/api/experiments/{id}/stream`, handles `state` / `phase` / `bucket` / `evidence` / `breach` / `report`; on error, poll `/samples?from=` every 2 s | §10.3 | Works against mock events, then live |
| ☐ | HA-02 | 3–5 | **Live page layout** (with Sanchi's tokens): header strip (service, fault, load, phase timer), phase timeline bar | FR-W3 | Renders from mock data |
| ☐ | HA-03 | 5–8 | **Live charts (Recharts):** RPS (target vs achieved), latency p50/p95/p99 + SLO line, error rate + SLO line; phase bands; batch renders every 500 ms | FR-W3 | Charts update < 2 s after a bucket arrives |
| ☐ | HA-04 | 7–9 | **Live graph states + evidence feed:** target node "fault injected" on `phase=fault`; dependent node "impact observed" **only** on an `evidence` event; feed rows | FR-W3 | **CP-B**: API node lights up only after evidence |
| ☐ | HA-05 | 8–9 | **Stop button on live page** + share `useExperimentStream` with Sanchi | FR-C7 | Abort → state `aborted`, Redis running (**H8**) |
| ☐ | HA-06 | 9–12 | **Capacity page:** config form validated against `GET /api/system/limits`, k6 script preview, step chart with **breach marker**, highest-pass / first-breach card | FR-W4 | Breach marker at the first failing step |
| ☐ | HA-07 | 12–14 | **Agent chat panel:** slide-over on every page; `POST /api/agent/chat` SSE (`thinking`, `tool_call`, `tool_result`, `plan`, `message`, `error`, `done`); collapsible tool-call lines | FR-W7, §10.4 | Works with mocked agent events, then live (**H6**) |
| ☐ | HA-08 | 14–16 | **Plan card + confirm:** experiment summary, preflight checklist (failed checks in red), Confirm / Cancel → `/actions/{id}/confirm` → navigate to the live page | FR-G2, FR-W7 | Confirm starts a run; Cancel discards; expired plan shows a message |
| ☐ | HA-09 | 15–16 | **Citations + errors:** citation chips `[E#]` / `[R]` / `[G]` link to evidence/report/graph; friendly states for `agent_disabled`, `rate_limited`, `timeout`, `grounding_failed`; hide chat when `/api/agent/status` says disabled | §9.5 | Each error state renders without breaking the page |
| ☐ | HA-10 | 16–20 | **Tests + polish:** Vitest for `StatusBadge`, SSE fallback, plan card; Playwright `fault-run.spec` and `kill-switch.spec` | PROGRESS §8 Phase 4 | Tests green |

**Harshit depends on:** Yash for mocks (H2) and CORS; Ayush for live events (H5) and agent endpoints (H6); Sanchi for tokens (H7).
**Harshit hands over:** H8 `useExperimentStream` hook (hour 8).

---

## Everyone: demo & rehearsal

| ✓ | ID | Hour | Task | Owner | Done when |
|---|---|---|---|---|---|
| ☐ | ALL-01 | 4, 8, 12, 16, 20 | 5-minute stand-up: what's done, what's blocked, next handoff | All | Blockers named and owned |
| ☐ | ALL-02 | 16 | **Feature freeze.** Only bug fixes after this | All | No new features merged |
| ☐ | ALL-03 | 18–22 | Rehearse the 3-minute script (PRD §16) **3× in a row**, timed | All (Yash drives CLI, Harshit drives chat, Sanchi drives graph/report) | ≤ 3:00, no failures |
| ☐ | ALL-04 | 20–22 | Backup video of a clean run; recorded fallback labelled `RECORDED` | Yash | Video saved locally + on USB |
| ☐ | ALL-05 | 22–24 | Final check: `docker ps` shows all demo services running, `.env` not committed, README status honest | All | Checklist signed off |

---

## Handoff timeline (at a glance)

```
Hour  2  H1  Yash    → all       API contract frozen
Hour  3  H2  Yash    → Sanchi, Harshit   TS types + mock JSON
Hour  3  H3  Ayush   → Yash      Honest controller (Phase 0)
Hour  4  H7  Sanchi  → Harshit   Design tokens + badges
Hour  5  H4  Yash    → Ayush     Demo app + endpoints.yaml        ── CP-A
Hour  8  H8  Harshit → Sanchi    useExperimentStream hook
Hour  9  H5  Ayush   → Yash, Harshit   Live evidence/breach events ── CP-B
Hour 13  H6  Ayush   → Harshit, Yash   Agent endpoints
Hour 16  H9  Yash    → all       Connection checklist C1–C8        ── CP-C, freeze
```

## Working rules

- Branch per task: `feat/<name>-<task-id>` (e.g. `feat/ayush-AY-04`).
- PR title starts with the task ID; reviewer from the *other* side (backend ↔ frontend).
- Any change to the API contract updates PRD §10 in the same PR.
- Tick the box here in the PR that finishes the task.
