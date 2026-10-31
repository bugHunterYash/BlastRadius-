# BlastRadius — Project Plan

> **Break it before production does.**
> Simulate service failures, replay synthetic traffic, and find your application's breaking point before you deploy to production — then hand your AI agent the fix and prove it worked.

---

## 0. Ground rules (read first)

1. **The demo loop is the product.** Everything serves this 90-second arc: **map → break → measure → fix → re-test**.
2. **Evidence over assumption, always.** Every claim is traceable to a measurement, a declared config line, or is explicitly labeled predicted/unknown. The product never guesses.
3. **Only test what you own/control.** Localhost, own deployments, or labeled test environments with explicit permission. No production targets, ever, in this build.
4. **Non-destructive only.** Stop/start/pause and reversible network faults. No volume removal, no data writes, no `docker rm`.
5. **Feature freeze before polish.** P0 must work end to end before any P1; P1 before any P2. Cut extras, never cut measurements, preflight, kill switch, or guaranteed restore.
6. **Honest numbers or no numbers.** Missing metrics are reported `unavailable` with a reason — never zero-filled. Breaking points are tested ranges, never fabrications.

---

## 1. Overview

BlastRadius is a resilience and capacity testing platform for containerized applications. It parses a Docker Compose file to map service dependencies, injects controlled faults under synthetic load, ramps traffic to find capacity limits, and produces evidence-based reports on what breaks, how badly, and how long recovery takes — then generates a paste-ready fix prompt for your AI coding agent and verifies the fix with a re-test.

The product ships as two surfaces over one shared core:

| Surface | Role |
|---|---|
| **CLI (`br`)** | Headless control for engineers and CI — run experiments, get exit codes, export reports and fix prompts |
| **Web Dashboard** | Deep interactive analysis — live graphs, charts, phase timelines, reports, before/after, history |

### The product loop (the differentiator)

```
MAP          BREAK         MEASURE              FIX                RE-TEST
compose  →   inject    →   evidence-based   →   fix prompt    →   before/
graph        fault /       report + score       for Claude        after
             ramp load                          Code / Cursor     comparison
"What could  "What did     "How bad, how                                 "Did it
 break?"      break?"       long, where?"                                 survive?"
```

Launchproof-style insight we adopt: a report alone is not a product. The **fix prompt** (one copy-paste artifact for Claude Code / Cursor) and the **before/after re-test** close the loop and make the result actionable and provable.

### Core principle: evidence over assumption

Every claim falls into one of four confidence levels, and the UI always shows which applies:

| Level | Source | Example |
|---|---|---|
| **Declared** | Explicit in Compose config (`depends_on`, `links`) | `api depends_on redis` |
| **Inferred** | Heuristic (env vars, shared networks, image names) | `worker` has `DATABASE_URL=postgres://db…` |
| **Verified** | Observed during an experiment | Redis stopped → `/api/cart` error rate 0% → 94% |
| **Unknown** | Not determinable from available data | No metrics exporter on `worker` |

A graph edge never becomes "verified impact" by itself. Only measurements can do that.

---

## 2. Goals

### Product goals
- Answer the reliability questions teams skip before deploy: what breaks, what's affected, how fast errors rise, how much traffic the app takes, where the bottleneck is, how long recovery lasts
- Unify **resilience testing** (fault injection) and **capacity testing** (load ramping) into one graph, one timeline, one report
- Make every claim traceable to a measurement or explicitly labeled as predicted/unknown
- **Close the loop:** hand the user a deterministic fix prompt and prove the fix with a before/after re-test
- Be CI-native via the CLI: exit codes that fail builds on resilience regressions

### What we can honestly claim (and how)

| We detect | How |
|---|---|
| Which services a failure would affect | Compose graph (declared/inferred) + reverse BFS — **predicted, labeled as such** |
| Which services a failure actually affected | Measured error/latency/health evidence during the experiment — **verified** |
| Real breaking point under load | k6 load ramp against SLOs — tested range, never assumed |
| Recovery time after a fault | Measured: first N consecutive seconds within SLO after restore |
| Bottleneck type (CPU / pool / downstream) | Deterministic rules over collected metrics; **`unknown` when data is missing** |
| Compose hygiene gaps | Gap analysis: missing healthcheck, limits, restart policy, single-DB SPOF |
| The fix | Deterministic fix-prompt template generated from recommendations + evidence — not LLM-invented |

### Non-goals (explicitly out of scope)
- Running against production (including opt-in) in this build
- Replaying real production traffic or real user data
- Kubernetes / Helm / Terraform parsing (future work)
- Network-partition or disk-fill chaos (destructive)
- Distributed or multi-region load generation
- Supply-chain / dependency scanning
- Full application-source static analysis (pooling/N+1/indexes) — future work; we analyze **compose**, not app code, in this build

---

## 3. Team & Ownership

| Role | Owns | Done means |
|---|---|---|
| **Backend / core** | Compose parser, graph builder, preflight, controller, analysis, report builder, fix-prompt generator, API + SSE | `br run` and the web both produce a real experiment report from a live run |
| **Load / fault / infra** | k6 runner, Docker fault injector, watchdog/restore, metrics collector, demo-app infra | Redis stop/restore under load produces measurable, reproducible impact |
| **Frontend** | React dashboard: graph, live charts, report, fix-prompt panel, before/after | Graph lights up only on evidence; charts show real numbers; fix prompt is copy-pasteable |
| **Demo / pitch** | Demo app, seeded data, recorded fallback, pitch script, rehearsal | Full 90-second loop runs cleanly 3× on the demo laptop; backup video exists |

Shared duty: every numeric claim in UI/report must be traceable to a stored bucket or evidence item. Nothing is "done" until its tests pass.

---

## 4. Architecture

### 4.1 High-level components

```
┌─────────────────────────────────────────────────────────────┐
│                      SURFACES                               │
│   ┌──────────────┐                      ┌────────────────┐  │
│   │  CLI (br)    │                      │ Web Dashboard  │  │
│   │  Typer+Rich  │                      │ React + Vite   │  │
│   └──────┬───────┘                      └───────┬────────┘  │
│          │ direct import                        │ REST + SSE │
│          ▼                                      ▼           │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              SHARED CORE LIBRARY                     │   │
│   │  compose parser · gap analysis · graph builder ·     │   │
│   │  preflight · experiment controller · load runner ·   │   │
│   │  fault injector · metrics collector · analysis ·     │   │
│   │  report builder · fix-prompt generator · schemas     │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │                              │
│        ┌─────────────────────┼─────────────────────┐        │
│        ▼                     ▼                     ▼        │
│   ┌─────────┐        ┌──────────────┐      ┌────────────┐   │
│   │   k6    │        │ Docker SDK   │      │ PostgreSQL │   │
│   │ runner  │        │ (faults)     │      │            │   │
│   └─────────┘        └──────────────┘      └────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  TARGET APP (isolated network) │
              │  frontend · api · redis ·      │
              │  postgres · worker             │
              └───────────────────────────────┘
```

### 4.2 Key architectural decisions

| Decision | Choice | Rationale |
|---|---|---|
| Shared core library | Parser, gap analysis, schemas, analysis, controller, fix-prompt extracted into an importable package | CLI runs standalone without HTTP self-calls; API reuses the same logic |
| Load generator | k6 (subprocess, template-generated scripts) | Open-model arrival-rate avoids coordinated omission; hard caps built-in; per-request JSON stream. (autocannon/closed-model rejected: coordinated omission hides latency) |
| Fault injection | Docker SDK, label-gated | Precise container control; only allowlisted, labeled containers are touchable |
| Live updates | **SSE** (`/api/experiments/{id}/stream`) with polling fallback | All live messages are server→client (state, phase, bucket, evidence, breach, log); abort is a REST POST. SSE is simpler and sufficient — "keep it boring" |
| Storage | PostgreSQL; CLI may run ephemeral (or SQLite) for quick local runs | Persistence where it matters; zero-config for quick CLI runs |
| Task queue | None — in-process asyncio | One experiment at a time; a queue is unnecessary overhead |
| Percentiles | Computed from raw per-request samples | Keeps numbers testable; enables phase bucketing |
| Fix prompt | Deterministic template filled from report data (recommendations, evidence, breaking point) | No LLM required for the core artifact; grounded by construction. AI explanations (P2) are optional garnish, never the source |
| Score | Deterministic 0–100 resilience score from evidence (P2) | One memorable number for the pitch; derived, never hand-set |

### 4.3 Experiment lifecycle

```
Create config → Preflight (9 safety checks) → Start
  → BASELINE phase (constant load, e.g. 20s)
  → inject fault (e.g. stop Redis)          [fault experiments]
  → FAULT phase (e.g. 20s)
  → restore fault
  → RECOVERY phase (until SLOs hold for N s, or timeout)
  — or —
  → LOAD STEPS 1× → 2× → 5× → 10×          [capacity experiments]
  → Persist samples, phase stats, evidence, report, fix prompt
  → State = COMPLETED / ABORTED / AUTO_STOPPED
  → [optional] Apply fix → re-run same config → before/after comparison
```

Load runs continuously at a constant rate across fault phases so comparisons are controlled. Kill switch and watchdog restore run regardless of phase.

---

## 5. Modules

### Module A — Architecture Intelligence
*"What could break?"*

- Parse `docker-compose.yml` / `compose.yaml` (max 256 KB, `yaml.safe_load` only)
- Build dependency graph: declared edges (`depends_on`, `links`) + inferred edges (env-var host detection, shared networks)
- Service classification heuristics: database / cache / queue / api / worker / frontend / unknown (user-overridable)
- Predicted blast radius: reverse BFS over declared + inferred edges, with path explanations — always labeled "predicted, not verified"
- Helpful validation errors (line/column, unknown deps, cycles, oversize)
- **Gap analysis** (deterministic, from compose — "what's missing" alongside "what could break"):
  - Missing `healthcheck` on stateful or API services
  - Missing `deploy.resources.limits` (CPU/memory)
  - Missing `restart` policy
  - Single database with no replica/HA hint → SPOF warning
  - Ports published on `0.0.0.0` (exposure warning)
  - No cache service while API reads/writes per-request (heuristic)
  - Each gap is a finding with severity + the compose line that triggered it — shown as red dashed "missing" badges on the graph, Launchproof-style
- Uncertainty banner: compose describes config, not runtime behavior

### Module B — Failure Simulator
*"What did break?"*

- Fault scenarios: `stop_container` (P1), `pause_container`, `stop_api_replica`, `latency` (toxiproxy), `error_injection` (all P2)
- Experiment types: `fault` (constant load), `capacity` (ramp load), `fault_under_load` (both, explicitly confounded)
- Phases: BASELINE → FAULT → RECOVERY, timestamped, every metric bucket phase-tagged
- Measurements per 1s bucket: requests, successes, failures, RPS, p50/p95/p99/max, per-endpoint, health status
- Recovery time: measured as first N consecutive seconds within SLO after restore — never assumed; reports "not recovered within Xs" honestly
- Impact attribution: services marked "observed impact" only with recorded evidence (request errors ≥ threshold outside noise, latency regression, health-check failure)
- 9-point preflight: env label, fault allowlist, production guard, network isolation, load allowlist, limits, target health, concurrency lock, restore path

### Module C — Traffic Twin Load Testing
*"How much can it take?"*

- Config: target URL (allowlisted), GET-only endpoints, baseline RPS, multipliers, step duration, VUs, timeout — all server-side hard-capped
- k6 `ramping-arrival-rate` script generated from template (users never supply raw JS)
- Metrics: RPS, error rate, percentiles from raw samples, dropped iterations (generator health), optional CPU/mem/DB-pool
- SLOs: p95_ms, max_error_rate, min_rps_ratio — drawn as reference lines; breach markers on first failing step
- Breaking point: reported as a tested range ("between 100 and 200 RPS"), never fabricated; "no breach up to tested max" when applicable
- Safety auto-stop: error rate > 50%, p95 > 5s, health fail, duration grace, request cap — plus k6 `abortOnFail` as independent second net
- Bottleneck classification (P2): cpu_bound / memory_pressure / db_connection_exhaustion / downstream_latency / load_generator_limited / **unknown** (default)

### Module D — Fix Prompt & Re-test (the closer)
*"Here's how to fix it — and proof it worked."*

- **Fix prompt generator** (deterministic, no LLM required): a single copy-paste prompt for Claude Code / Cursor / any CLI agent, filled from the report:
  - Measured breaking point / failure mode ("Redis down → `/api/cart` error rate 94%")
  - Ordered recommendations (P1 first), each with rationale + evidence ref
  - Constraints: keep routes/response shapes, config via env vars, don't remove features
  - Acceptance criteria: re-run the same experiment config and pass the same SLOs
  - Rendered in the report page and `br report --fix-prompt` — one Copy button
- **Before/after re-test** (P1): after the user applies the fix, re-run the identical experiment config against the updated stack. Side-by-side: baseline vs fixed (p95, error rate, breaking point, recovery time, score). Fairness rule: **same CPU/memory limits, same load config** — improvement must come from architecture, not bigger hardware.
- Confounded-run rule still applies: never claim a single cause from a run that changed two variables.

### The Unified Workflow (differentiator)
One application, one graph, one timeline — resilience and capacity questions answered in the same workspace, closed with an actionable fix and a proven re-test. Combined runs (`fault_under_load`) are labeled confounded; the report generator refuses causal statements without a controlled comparison run in history.

---

## 6. Surfaces

### 6.1 CLI — `br`

Headless control for engineers and CI. Human-readable by default, `--json` everywhere for scripting.

| Command group | Commands | Purpose |
|---|---|---|
| `br parse` | `br parse compose.yaml` | Parse + graph + gap findings (tree/JSON), validation errors |
| `br graph` | `br graph impact <service>` | Predicted blast radius |
| `br experiment` | `br run <config>` · `br status <id>` · `br logs <id> -f` · `br abort <id>` | Run, watch, kill experiments |
| `br report` | `br report <id> [--md --out f.md] [--fix-prompt]` · `br compare <a> <b>` | Render / export report, fix prompt, diff runs |
| `br history` | `br history` | List past experiments |
| `br reset` | `br reset` | Restore all faulted containers, clear locks |
| `br demo` | `br demo up` · `br demo down` | Manage the demo stack |

**CI characteristics:**
- Exit codes: `0` = SLOs held, `1` = breach/failure found, `2` = error
- Runs standalone (in-process controller) or remote (`--remote http://127.0.0.1:8000`)
- Same Pydantic validation as the API
- Live output: ANSI phase ticker, sparkline metrics, status colors matching the dashboard
- `Ctrl+C` during `br run` triggers the abort path (kill switch from the terminal in P0)

### 6.2 Web Dashboard

Deep interactive analysis. Restrained dark theme; status = color + icon + text label (never color alone).

| Page | Contents |
|---|---|
| **Overview** | App status, current experiment, metric tiles, global kill switch, last-experiment card, history |
| **Architecture** | YAML upload/paste with inline validation, React Flow graph (dagre), legend, **missing-piece badges (red dashed)** from gap analysis, inspector (kind, deps, dependents, predicted radius with paths, verified impacts with evidence links, gap findings, "run experiment" action) |
| **Experiment (live)** | Header strip (service, fault, load, phase timer), phase timeline bar, live graph states + stacked charts (RPS, latency + SLO, errors + SLO) with phase bands, evidence feed, kill switch |
| **Traffic Twin** | Config form with live validation, generated k6 script preview, step charts with breach markers, summary card (highest passing / first breach), resource panel |
| **Report** | Config, phase comparison table, verified impacts + evidence, predicted-not-observed, recovery, capacity summary, bottleneck + missing signals, gap findings, limitations, prioritized recommendations, **fix-prompt panel (monospace + Copy)**, resilience score (P2), Markdown/JSON export |
| **Before / After** | Two runs side by side: p95, error rate, breaking point, recovery, score — same-config fairness note |
| **History / Compare** | Run list; side-by-side comparison |

---

## 7. Tech Stack

| Layer | Choice |
|---|---|
| Shared core | Python 3.11+, Pydantic v2 |
| Backend API | FastAPI, asyncio, **SSE** (polling fallback) |
| CLI | Python, Typer/Click, Rich |
| Load generator | k6 (bundled in backend image, subprocess) |
| Fault injection | Docker SDK for Python |
| Latency faults (P2) | Toxiproxy |
| Frontend | React, Vite, TypeScript, Tailwind, React Flow (`@xyflow/react`), Recharts |
| Storage | PostgreSQL 16 |
| Metrics (P2) | cAdvisor + Prometheus; `pg_stat_activity` / postgres_exporter |
| Demo app | Node.js 20 + Express, Redis 7, PostgreSQL 16, React storefront |
| AI (P2, optional) | Gemini — grounded explanations with numeric post-check; **never the source of the fix prompt or any number** |

---

## 8. Repository Structure

```
blastradius/
├── plan.md / BLASTRADIUS.md / README.md
├── docker-compose.yml            # control plane
├── Makefile                      # make up / demo / test / reset
├── core/                         # shared library (parser, gap analysis, schemas, controller, analysis, report, fix-prompt)
├── backend/                      # FastAPI app (imports core)
├── cli/                          # br CLI (imports core)
├── frontend/                     # React dashboard
├── demo-app/                     # system under test (compose.yaml, api, worker, frontend, db)
└── infra/                        # prometheus.yml, toxiproxy.json (P2)
```

---

## 9. Data Model (PostgreSQL)

| Table | Purpose |
|---|---|
| `architecture_graphs` | Parsed YAML + graph + gap findings JSONB |
| `experiments` | Config (immutable once started), state, preflight result, stop reason, timestamps, optional `compared_to` (before/after link) |
| `phase_markers` | Phase boundaries (baseline/fault/recovery/load_step) |
| `metric_buckets` | 1s JSONB buckets keyed by (experiment_id, t) |
| `evidence` | Evidence items (metric, baseline, observed, window, sample count) |
| `reports` | Final deterministic report JSONB (includes fix prompt, score when enabled) |

Raw k6 samples are aggregated in-memory into 1s buckets (not stored individually). Optional gzip of raw JSON per experiment for audit.

---

## 10. Safety Model

| Layer | Control |
|---|---|
| Ownership policy | Only systems you own or control. Localhost/own deployments auto-allowed. Future path for non-localhost: DNS TXT or `/.well-known` ownership verification before any load |
| Network exposure | Backend binds `127.0.0.1` by default; remote bind requires explicit flag + API token |
| Load targets | Hostname allowlist; resolved IP must be loopback/private/Docker; GET only; no redirect following |
| Fault targets | Container must be on allowlist AND labeled `blastradius.env=test` + `blastradius.fault-allowed=true`; DBs never faulted in MVP |
| Production guard | Any `prod`/`production` env marker aborts preflight; no override |
| Hard limits | RPS ≤ 500, VUs ≤ 200, duration ≤ 300s, requests ≤ 100k, timeout ≤ 10s — enforced in Pydantic, re-checked in runner, encoded in k6 |
| Auto-stop | Safety thresholds + k6 `abortOnFail` |
| Manual stop | Kill switch in UI header, `POST /abort`, `br abort` (incl. Ctrl+C on run), `make reset` |
| Guaranteed restore | Watchdog timer, `finally` restore, startup sweep for `blastradius.faulted-by` labels |
| Non-destructive | Only stop/start/pause/unpause and proxy toxics — no rm, volume ops, or data writes |
| No arbitrary code | k6 scripts generated from fixed template; user input JSON-escaped |
| Concurrency | Global lock — one experiment at a time |
| Fairness rule | Before/after comparisons use identical CPU/memory limits and load config — gains must be architectural |

---

## 11. Demo Application

Purpose: make results demonstrable and repeatable — and give the fix loop a real target.

| Service | Role | Fault-allowed |
|---|---|---|
| demo-frontend | React storefront | No |
| demo-api | Express + pg pool + ioredis | P2 |
| demo-redis | Session/cart cache | **Yes (P1)** |
| demo-postgres | Products, synthetic orders | **No** |
| demo-worker | Redis-list jobs → Postgres | No |

Teaching moments baked in: worker has no `depends_on` (edges inferred from env vars — demonstrates declared vs inferred); `/api/cart` has no Redis fallback (clear fault signal); `/api/products-cached` has DB fallback (shows graceful degradation); `PG_POOL_MAX=10` (reproducible pool-exhaustion breach at modest RPS); compose deliberately omits some healthchecks/limits so **gap analysis has something real to flag**.

All endpoints synthetic: `/health`, `/health/live`, `/api/products`, `/api/cart/:id`, `/api/checkout-preview`, `/api/products-cached`, `/api/slow`, `/api/cpu`, `/metrics`.

**Expected numbers (hypotheses — fill in after real runs, never pre-scripted):**

| Scenario | Hypothesis |
|---|---|
| Redis stopped | `/api/cart` + `/api/checkout-preview` errors spike; `/api/products` unaffected; `/api/products-cached` latency rises, errors stay low |
| Redis restored | Errors return to baseline within a few seconds (measure it) |
| Load ramp | p95 rises past SLO once concurrency exceeds `PG_POOL_MAX=10`; pool-waiting clients signal exhaustion |

**Demo discipline:**
- Rehearse the full 90-second loop (map → break → recover → ramp → report → fix prompt → before/after) at least 3× on the demo laptop
- Record a backup video before the pitch; keep it open in a second tab
- One **recorded fallback run** cached in the DB, clearly labeled `RECORDED`, if the live run fails
- Demo-critical data and the recorded run work offline (no dependency on venue WiFi)

---

## 12. Optional AI Features (P2)

| Feature | Guardrail |
|---|---|
| Explain failures, summarize architecture, expand recommendations, compare runs | Uses only numbers from input JSON; every output number post-checked against input; mismatch → discard + "AI summary unavailable"; always labeled "AI-generated"; API key unset → 503 and UI hides button; env values redacted before sending. **The fix prompt and all numbers come from the deterministic core, never from the LLM** |

---

## 13. Testing Strategy

| Type | Coverage |
|---|---|
| **Unit** | Parser (valid/invalid fixtures), gap analysis (each rule), graph builder (declared/inferred/predicted radius), percentiles (incl. hand-computed phase check), SLO breach detection, recovery measurement, hard limits, preflight rejections, missing-metric honesty, report determinism, fix-prompt template fill, confounded-run flagging, AI grounding |
| **Integration** | Real k6 against demo app (request-count parity), cancellation (abort → process gone, state ABORTED), Redis fault → measurable impact + evidence, restore + recovery, abort-restores-faults, safety auto-stop, before/after same-config comparison |
| **Component (frontend)** | Status badges render text+icon (not color alone); chart phase bands; fix-prompt copy button |

Integration tests require the demo stack up and are marked separately. Nothing is "done" until its tests pass.

---

## 14. Implementation Priorities

### P0 — End-to-end spine (build first, nothing else until it works)
1. Compose parser + validation errors
2. Dependency graph (declared + inferred)
3. React Flow graph UI (web)
4. k6 load runner with hard limits
5. Live latency/error charts (SSE stream)
6. Experiment persistence + basic report
7. Demo app (all 5 services)
8. **CLI: `br run` (capacity), `br report`, `--json`, Ctrl+C abort**

### P1 — The differentiator
9. Preflight safety checks (full 9-point)
10. Redis stop/restore fault + guaranteed restore
11. Phase-segmented metrics + phase comparison
12. Measured recovery time
13. Evidence-based graph highlighting
14. Load ramp + breach detection + breaking-point range
15. Kill switch everywhere (UI, API, CLI)
16. **Fix-prompt generator + report panel + `br report --fix-prompt`**
17. **Before/after same-config re-test + comparison view**
18. **CLI: live streaming output, CI exit codes, `br parse`, `br abort`, `br reset`, `br status`, `br logs`**
19. **Compose gap analysis (missing healthcheck/limits/restart/SPOF) + graph badges**

### P2 — Polish (cut first if pressured)
20. CPU/memory via docker stats / cAdvisor
21. DB pool diagnostics
22. Bottleneck classification
23. Latency injection (Toxiproxy), pause, stop-API scenarios
24. Resilience score (0–100, deterministic)
25. Run-vs-run history compare (beyond the primary before/after)
26. Gemini explanations (garnish only)
27. History page, report export
28. **CLI: `br compare`, `br demo up/down`, `br history`, `br graph`, shell completion, config profiles**

### Cut order under pressure
Gemini → score → Toxiproxy → history compare → bottleneck classification → docker stats → load-ramp refinement.

### Never cut
Real measurements, preflight, kill switch, guaranteed restore, fix prompt (it's a template fill — cheap and it closes the demo).

### Checkpoints
- **P0 gate:** full spine works end to end (upload → graph → load test → live charts → saved report) before any P1 starts
- **P1 gate:** full demo loop (map → break → recover → ramp → report → fix prompt → before/after) runs cleanly before any P2 starts
- **Freeze:** after P1 gate, no new features — bug fixes, polish, rehearsal only

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Docker socket permissions (Windows/WSL) | Test on demo machine early; document WSL2 requirement |
| k6 saturates the laptop, not the app | Track `dropped_iterations`; cap at 500 RPS; label `load_generator_limited` |
| Redis restore slow / no reconnect | Tune `retryStrategy`; slow recovery is still a valid measured finding |
| Noisy laptop measurements | Short baselines, show sample counts, 3σ noise rule |
| Live demo failure | Recorded fallback run (clearly labeled RECORDED), backup video, rehearse 3×, demo works offline |
| Fix applied but app won't start | Before/after is optional — primary demo (break → report → fix prompt) stands alone; re-test is the encore |
| Scope creep into P2 | Hard P0/P1 gates; freeze after P1; cut list above |
| Gemini hallucinating numbers | Grounding post-check; optional feature; fix prompt is deterministic |

---

## 16. Pitch & Demo Script (3 minutes)

| Time | Act | On screen | Say |
|---|---|---|---|
| 0:00–0:20 | **Hook** | Overview | "Every team ships hoping Redis never dies and traffic never doubles. BlastRadius finds out first — with measurements, not guesses." |
| 0:20–0:45 | **Map** | Upload compose → graph. Click Redis → predicted radius + **gap badges** | "Solid edges declared, dashed inferred. Red badges: missing healthcheck, no limits. All predictions. Let's verify." |
| 0:45–1:20 | **Break & recover** | Fault run: baseline → stop Redis → evidence lights up → restore → recovery timer | "Cart errors went 0→94%. The API node lit up only after we measured it. Recovery took [n]s — measured, not assumed." |
| 1:20–1:50 | **Capacity** | Ramp 1×→10×, breach marker | "No faults, just load. At [m]× p95 crosses 300ms. Bottleneck: DB pool exhaustion." |
| 1:50–2:20 | **Fix & re-test** | Fix prompt panel → Copy → before/after charts | "One prompt for your AI agent — every fix tied to evidence. We ran it earlier. Same hardware, same load: survives now." |
| 2:20–2:40 | **Report** | Report page | "One honest report: every claim linked to evidence, limitations listed, nothing guessed." |
| 2:40–3:00 | **Close** | Tagline | "BlastRadius. Break it before production does." |

**Judge Q&A anchors:** "Isn't this just k6?" — k6 says *that* it broke; we say *why* (graph + evidence), hand you the fix, and *verify* it. · "How do you know Redis matters?" — we don't assume; compose predicts, measurement verifies, and we label which is which. · "Load testing = DDoS?" — allowlisted, labeled test environments only; hard caps; kill switch; guaranteed restore.

---

## 17. Success Criteria

- **Demo loop:** upload compose → graph + gap badges → break Redis → live evidence appears → recover (time measured) → ramp load → breach marked → honest report → copy fix prompt → before/after re-test shows survival
- **CI:** `br run experiments/redis-fault.yaml --json` fails the pipeline (exit 1) when a resilience regression appears
- **Honesty test:** every claim in UI/report is traceable to a measurement, a declared config line, or is explicitly labeled predicted/unknown — the product never guesses
- **Actionability test:** a user can paste the fix prompt into Claude Code / Cursor and get a working fix without reading our source code
