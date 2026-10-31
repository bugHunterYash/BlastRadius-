# BlastRadius

> **Break it before production does.**

Simulate service failures, replay synthetic traffic, and find your application's breaking point before you deploy to production.

**Event:** CBS 9.0 Hackathon (24 hours)
**Document type:** Product and engineering specification, build plan, and demo runbook
**Note:** original spec, kept for reference. The current source of truth is [PRD.md](PRD.md).
**Status (at time of writing):** Planning. No code has been written yet. See [§18 Implementation Status](#18-implementation-status).

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Scope and Non-Goals](#2-scope-and-non-goals)
3. [Smallest End-to-End MVP](#3-smallest-end-to-end-mvp)
4. [System Architecture](#4-system-architecture)
5. [Monorepo Structure](#5-monorepo-structure)
6. [Module A: Architecture Intelligence](#6-module-a--architecture-intelligence)
7. [Module B: BlastRadius Failure Simulator](#7-module-b--blastradius-failure-simulator)
8. [Module C: Traffic Twin Load Testing](#8-module-c--traffic-twin-load-testing)
9. [The Unified Workflow](#9-the-unified-workflow-the-differentiator)
10. [API Contracts and Pydantic Schemas](#10-api-contracts-and-pydantic-schemas)
11. [Data Model (PostgreSQL)](#11-data-model-postgresql)
12. [Safety Model](#12-safety-model)
13. [Demo Application](#13-demo-application)
14. [Dashboard Design](#14-dashboard-design)
15. [Interfaces: CLI and Web Dashboard](#15-interfaces-cli-and-web-dashboard)
16. [Optional AI Features (Gemini)](#16-optional-ai-features-gemini)
17. [Testing and Validation](#17-testing-and-validation)
18. [Implementation Status](#18-implementation-status)
19. [24-Hour Build Plan](#19-24-hour-build-plan)
20. [Setup and Deployment](#20-setup-and-deployment)
21. [Three-Minute Demo Script](#21-three-minute-demo-script)
22. [Risks and Mitigations](#22-risks-and-mitigations)
23. [Glossary](#23-glossary)

---

## 1. Product Vision

### The problem

Teams often deploy without answering basic reliability questions:

| Question | Answered by |
|---|---|
| What happens if Redis, the database, or an API service goes down? | Module B (failure simulator) |
| Which dependent services does a failure affect? | Module A (predicted) + Module B (verified) |
| How quickly do error rates rise during an outage? | Module B time-series |
| How much traffic can the application handle? | Module C (load ramp) |
| At what load does p95 latency exceed the target? | Module C (SLO breach detection) |
| Is the bottleneck CPU, memory, DB connections, or something else? | Module C diagnostics (reported as **unknown** when we lack the data) |
| How long does the system take to recover after a failure? | Module B recovery measurement |

### The product

One platform with three connected modules:

```
┌────────────────────────┐   ┌────────────────────────┐   ┌────────────────────────┐
│ A. Architecture        │   │ B. BlastRadius         │   │ C. Traffic Twin        │
│    Intelligence        │──▶│    Failure Simulator   │◀─▶│    Load Testing        │
│ "What COULD break?"    │   │ "What DID break?"      │   │ "How much can it take?"│
└────────────────────────┘   └────────────────────────┘   └────────────────────────┘
              │                          │                            │
              └──────────────────────────┴────────────────────────────┘
                                         ▼
                           Evidence-based Experiment Report
```

Everything is available through **two interfaces to the same engine** (see [§15](#15-interfaces-cli-and-web-dashboard)):

| Interface | Best for |
|---|---|
| **`blastradius` CLI** | Terminal workflows, scripts, CI/CD gates (exit codes), declarative experiment files |
| **Web dashboard** | Interactive dependency graph, live charts, demos, report browsing |

### Core principle: evidence over assumption

Every claim the product makes falls into one of these confidence levels, and the UI always shows which one applies:

| Level | Source | Example | UI treatment |
|---|---|---|---|
| **Declared** | Explicit in the Compose file (`depends_on`, `links`) | `api depends_on redis` | Solid edge, "declared" badge |
| **Inferred** | Heuristic (env vars like `REDIS_URL`, shared networks, image names) | `worker` has `DATABASE_URL=postgres://db…` | Dashed edge, "inferred" badge with the reason |
| **Verified** | Observed during an experiment (requests failed, health checks failed, log errors) | Redis stopped → `/api/checkout` error rate 0% → 94% | Edge and node marked "observed impact" with a link to the evidence |
| **Unknown** | Not determinable from the available data | No metrics exporter on `worker` | Grey, "unverified" label |

A graph edge **never** becomes a verified impact by itself. Only measurements can do that.

---

## 2. Scope and Non-Goals

### In scope

- Docker Compose parsing and dependency graphs
- Controlled fault injection against an **allowlisted, isolated test environment**
- Synthetic load generation against **allowlisted local or staging targets**
- Metrics collection, SLO evaluation, breaking-point detection
- Persisted experiments and reports
- Optional AI explanations, grounded strictly in recorded data

### Explicitly out of scope

- **PackageTrap, npm dependency scanning, and supply-chain analysis**. None of these are part of this project.
- Running against production, including by opt-in, in the hackathon build
- Replaying real production traffic or real user data
- Kubernetes, Helm, Terraform parsing (future work)
- Network-partition or disk-fill chaos (destructive; out of scope)
- Distributed or multi-region load generation

---

## 3. Smallest End-to-End MVP

This is the thinnest slice that proves the full idea live on stage. **Build it first. Add nothing else until it works end to end.**

```
Upload compose.yaml ─▶ Graph renders ─▶ Run 60s load test against demo app
      ─▶ Live p95/error chart ─▶ Stop Redis mid-test ─▶ Restore Redis
      ─▶ Phase comparison (baseline / fault / recovery) ─▶ Saved report
```

| Priority | Item | Why it matters |
|---|---|---|
| **P0** | Compose parser + validation errors | Entry point for everything |
| **P0** | React Flow dependency graph | First visual "wow" |
| **P0** | Real k6 load test against the demo app | Credibility: real numbers |
| **P0** | Live latency and error charts from real measurements | Core feedback loop |
| **P0** | Persist experiment + basic report | "Evidence-based" claim |
| **P1** | One fault scenario: **stop Redis**, then restore | The differentiator |
| **P1** | Phase-segmented metrics (baseline / fault / recovery) | Resilience answer |
| **P1** | Graph highlights only **observed** impact, with evidence | Honesty principle |
| **P1** | Recovery time measured, not assumed | Resilience answer |
| **P1** | Load ramp (1×→2×→5×→10×) with first SLO breach marked | Capacity answer |
| **P1** | `blastradius` CLI core: `parse`, `impact`, `load run`, `fault run`, `abort`, `report`, exit codes | Second interface; CI story |
| **P2** | CLI extras: `run -f`, `list`, `compare`, `open`, live Rich view polish | Polish |
| **P2** | Latency injection (toxiproxy), stop-API scenario | More scenarios |
| **P2** | cAdvisor/Prometheus CPU/memory, `pg_stat_activity` | Bottleneck diagnosis |
| **P2** | Run-vs-run history comparison | Polish |
| **P2** | Gemini explanations | Polish |

**Scope estimate:** P0 is about 8–10 focused hours for a team of 3–4. P1 adds about 6–8 hours. P2 fits only into the remaining time. **Cut any P2 item that threatens the end-to-end demo.**

---

## 4. System Architecture

### 4.1 Component diagram

```mermaid
flowchart LR
    subgraph CP["CONTROL PLANE"]
        UI["React Dashboard<br/>(Vite + TS + Tailwind<br/>React Flow + Recharts)"]
        CLI["blastradius CLI<br/>(Typer + Rich)"]
        API["FastAPI Backend<br/>(REST + WebSocket)"]
        PARSER["Config Parser<br/>(compose → model)"]
        GRAPH["Architecture Graph Service<br/>(declared / inferred / verified)"]
        CTRL["Experiment Controller<br/>(state machine, phases,<br/>limits, kill switch)"]
        DB[("PostgreSQL<br/>experiments, samples,<br/>reports")]
    end

    subgraph TR["TEST RUNNER"]
        LOAD["Load-Testing Runner<br/>(k6 subprocess,<br/>JSON stream)"]
        FAULT["Fault-Injection Controller<br/>(Docker SDK, allowlisted<br/>containers only)"]
    end

    subgraph MC["METRICS COLLECTION"]
        COLLECT["Metrics Collector<br/>(k6 stream aggregation,<br/>health probes, docker stats,<br/>optional Prometheus)"]
        PROM["Prometheus + cAdvisor<br/>(optional, P2)"]
    end

    subgraph TA["TARGET APPLICATION (isolated Docker network: br-target)"]
        FE["demo-frontend<br/>(React)"]
        DAPI["demo-api<br/>(Node.js / Express)"]
        REDIS[("demo-redis")]
        PG[("demo-postgres")]
        WORKER["demo-worker"]
    end

    UI <-->|"REST + WS /ws/experiments/:id"| API
    CLI <-->|"REST + WS (same API)"| API
    API --> PARSER --> GRAPH
    API --> CTRL
    CTRL --> LOAD
    CTRL --> FAULT
    CTRL --> COLLECT
    CTRL --> DB
    GRAPH --> DB
    LOAD -->|"synthetic HTTP GET<br/>allowlisted endpoints"| DAPI
    FAULT -->|"stop / start / pause<br/>(label-gated)"| REDIS
    FAULT -.->|"P2"| DAPI
    LOAD -->|"per-request JSON"| COLLECT
    COLLECT -->|"health probes"| DAPI
    COLLECT -.->|"P2"| PROM
    PROM -.-> TA
    COLLECT --> DB
    FE --> DAPI
    DAPI --> REDIS
    DAPI --> PG
    WORKER --> REDIS
    WORKER --> PG
```

### 4.2 Experiment lifecycle (sequence)

```mermaid
sequenceDiagram
    autonumber
    participant U as Dashboard
    participant A as FastAPI
    participant C as Experiment Controller
    participant K as k6 Runner
    participant F as Fault Controller
    participant M as Metrics Collector
    participant T as Demo App
    participant D as PostgreSQL

    U->>A: POST /experiments (config)
    A->>C: validate + create (state=PENDING)
    C->>C: Preflight (allowlist, isolation, labels, limits, target healthy)
    alt preflight fails
        C-->>U: 422 + failed checks
    end
    U->>A: POST /experiments/{id}/start
    C->>K: spawn k6 (arrival-rate, hard caps)
    K->>T: synthetic GET requests
    K-->>M: per-request JSON lines
    M-->>U: WS 1s buckets (rps, p50/p95/p99, errors)
    Note over C: phase = BASELINE (e.g. 20s)
    C->>F: stop demo-redis (label-gated)
    Note over C: phase = FAULT (e.g. 20s)
    C->>F: start demo-redis
    Note over C: phase = RECOVERY (until SLOs hold for N s, or timeout)
    M->>M: recovery_time = first t where SLOs hold for N consecutive seconds
    C->>K: stop
    C->>D: persist samples, phase stats, evidence, report
    C-->>U: WS state=COMPLETED
```

### 4.3 Boundaries

| Boundary | Responsibility | Never does |
|---|---|---|
| **Control plane** (dashboard, CLI, FastAPI, controller, parser, graph, DB) | Validates config, enforces allowlists and limits, orchestrates phases, stores results, renders the UI. The dashboard and CLI are thin clients and hold no experiment logic | Sends load directly, touches containers outside the allowlist |
| **Test runner** (k6 runner, fault controller) | Executes **only** commands issued by the controller, within hard caps | Accepts arbitrary targets, runs without a controller-issued experiment ID |
| **Metrics collection** | Aggregates raw request results, probes health, reads container stats | Infers or fabricates metrics; missing sources are reported as `unavailable` |
| **Target application** | The system under test, on an isolated Docker network | Gets reached from the public internet through BlastRadius |

**Network isolation:** the demo app runs on a dedicated bridge network (`br-target`). The control plane joins it only to reach allowlisted endpoints. The FastAPI backend binds to `127.0.0.1` by default, so the load-testing API is never exposed publicly.

### 4.4 Technology choices

| Concern | Choice | Reason |
|---|---|---|
| Frontend | React + Vite + TypeScript + Tailwind | Fast iteration, typed contracts |
| Graph | React Flow (`@xyflow/react`) + dagre auto-layout | Interactive nodes, custom node components for status states |
| Charts | Recharts | Composable `ReferenceLine` (SLO lines) and `ReferenceDot`/`ReferenceArea` (breach markers, phase bands) |
| Backend | Python 3.11+, FastAPI, Pydantic v2, asyncio tasks | Native async WebSockets, schema-first validation |
| Live updates | WebSocket (`/ws/experiments/{id}`), polling fallback | 1s granularity without hammering REST |
| CLI | Typer + Rich + httpx + websockets | Same Python codebase and schemas as the backend; live terminal tables; CI exit codes |
| Load generator | **k6** (see below) | |
| Fault injection | Docker SDK for Python (`docker` package) | Precise, label-gated container control |
| Latency injection (P2) | Toxiproxy | Deterministic, reversible network faults with no kernel `tc` privileges needed |
| Metrics (P2) | cAdvisor + Prometheus; `postgres_exporter` or direct `pg_stat_activity` | Standard, no app changes needed |
| Storage | PostgreSQL 16 | Experiments, samples, reports, history |
| Task queue | **None**. In-process asyncio tasks | One experiment at a time; Redis queue is unnecessary |

#### Why k6 over Locust

| Criterion | k6 | Locust |
|---|---|---|
| Open-model load (fixed arrival rate) | Built-in `ramping-arrival-rate` executor | Closed model by default (users wait for responses), so throughput collapses as latency rises (coordinated omission) |
| Generator overhead | Go runtime, single binary, ~thousands RPS from one container | Python/gevent, needs workers for higher rates |
| Hard limits | `maxVUs`, `duration`, `gracefulStop` enforced by the engine | Must be implemented manually |
| Per-request output | `--out json=-` streams every sample, so we compute our own percentiles | Event hooks, CSV stats |
| SLO thresholds | Native `thresholds` + `abortOnFail` (second safety net) | Manual |

**Decision:** k6, executed as a sandboxed subprocess by the runner. The backend generates the k6 script from a template. Users never supply raw JavaScript, so arbitrary code cannot run.

> Note on accuracy: we compute p50/p95/p99 ourselves from the raw per-request JSON stream rather than trusting summaries. That keeps the numbers testable and lets us bucket them by phase.

---

## 5. Monorepo Structure

```
blastradius/
├── README.md
├── BLASTRADIUS.md                  ← this document
├── docker-compose.yml              ← control plane + demo app
├── .env.example
├── Makefile                        ← make up / make demo / make test / make reset
│
├── backend/                        ← FastAPI control plane
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── app/
│   │   ├── main.py                 ← app factory, CORS, routers, lifespan
│   │   ├── config.py               ← settings (pydantic-settings), allowlists, hard limits
│   │   ├── logging.py              ← structured JSON logging (structlog)
│   │   ├── db.py                   ← SQLAlchemy async engine + session
│   │   ├── models.py               ← ORM tables
│   │   ├── schemas/                ← Pydantic contracts (see §10)
│   │   │   ├── compose.py
│   │   │   ├── graph.py
│   │   │   ├── experiment.py
│   │   │   ├── metrics.py
│   │   │   └── report.py
│   │   ├── api/
│   │   │   ├── architecture.py     ← /api/architecture/*
│   │   │   ├── experiments.py      ← /api/experiments/*
│   │   │   ├── reports.py          ← /api/reports/*
│   │   │   ├── system.py           ← /api/health, /api/limits
│   │   │   └── ws.py               ← /ws/experiments/{id}
│   │   ├── services/
│   │   │   ├── compose_parser.py   ← YAML → ComposeModel, validation
│   │   │   ├── graph_builder.py    ← declared + inferred edges, impact paths
│   │   │   ├── preflight.py        ← safety checks
│   │   │   ├── controller.py       ← experiment state machine
│   │   │   ├── load_runner.py      ← k6 script generation + subprocess
│   │   │   ├── fault_injector.py   ← Docker SDK, label-gated
│   │   │   ├── metrics_collector.py← bucketing, percentiles, health probes
│   │   │   ├── analysis.py         ← phase stats, SLO breach, recovery, breaking point, bottleneck
│   │   │   ├── report_builder.py   ← deterministic report + recommendations
│   │   │   └── ai_explainer.py     ← optional Gemini (P2)
│   │   ├── cli/                    ← `blastradius` command (thin client, see §15)
│   │   │   ├── main.py             ← Typer app + global flags
│   │   │   ├── client.py           ← REST/WS client with timeouts
│   │   │   ├── commands/           ← parse, impact, load, fault, run, abort, report, list…
│   │   │   └── render.py           ← Rich live view, tables, graph tree
│   │   └── k6/
│   │       └── template.js.j2      ← k6 script template
│   └── tests/
│       ├── fixtures/               ← sample compose files (valid + invalid)
│       ├── unit/
│       └── integration/
│
├── frontend/                       ← React dashboard
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                 ← routes
│       ├── api/                    ← typed client + WS hook
│       ├── types/                  ← mirrors backend schemas
│       ├── pages/
│       │   ├── Overview.tsx        ← main dashboard
│       │   ├── Architecture.tsx    ← graph workspace
│       │   ├── TrafficTwin.tsx     ← load workspace
│       │   ├── Experiment.tsx      ← live run view (graph + charts)
│       │   └── Report.tsx          ← results + history
│       └── components/
│           ├── graph/ServiceNode.tsx, EdgeLegend.tsx, InspectorPanel.tsx
│           ├── charts/LatencyChart.tsx, ErrorRateChart.tsx, RpsChart.tsx
│           ├── experiment/PreflightChecklist.tsx, KillSwitch.tsx, PhaseTimeline.tsx
│           └── ui/StatusBadge.tsx, MetricTile.tsx
│
├── experiments/                    ← example experiment files for CLI / CI
│   ├── redis-outage.yaml
│   └── capacity-ramp.yaml
│
├── demo-app/                       ← the system under test
│   ├── compose.yaml                ← the file users upload in the demo
│   ├── api/                        ← Node.js + Express
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── src/server.js
│   ├── worker/                     ← Node.js background worker
│   ├── frontend/                   ← minimal React storefront
│   └── db/init.sql                 ← synthetic seed data only
│
└── infra/
    ├── prometheus.yml              ← P2
    └── toxiproxy.json              ← P2
```

---

## 6. Module A: Architecture Intelligence

### 6.1 Input

- Upload `docker-compose.yml` / `compose.yaml` (max 256 KB), or paste YAML.
- Parsed with `yaml.safe_load` only. Never `yaml.load`; no anchors that explode (alias count capped).
- Supported Compose keys: `services`, `image`, `build`, `ports`, `expose`, `depends_on` (short and long form incl. `condition`), `links`, `environment` (list and map), `env_file` (name only, not read), `healthcheck`, `networks`, `deploy.resources.limits`, `labels`, `restart`.
- Unsupported keys are preserved and listed as "not analysed", never silently dropped.

### 6.2 Validation errors (helpful, specific)

| Condition | Error message |
|---|---|
| Not valid YAML | `Line 14, column 3: mapping values are not allowed here` |
| No `services` key | `No 'services' section found. BlastRadius supports Compose files with a top-level 'services' map.` |
| `depends_on` references unknown service | `Service 'api' depends on 'cache', which is not defined in services.` |
| Dependency cycle | `Dependency cycle detected: api → worker → api` |
| File too large | `File is 1.2 MB; maximum supported size is 256 KB.` |
| Invalid port spec | `Service 'web': port '80:abc' is not a valid port mapping.` |

### 6.3 Service classification (heuristic, labelled as inferred)

| Kind | Signals |
|---|---|
| `database` | image matches `postgres`, `mysql`, `mariadb`, `mongo`; ports 5432/3306/27017 |
| `cache` | image matches `redis`, `valkey`, `memcached`; port 6379/11211 |
| `queue` | image matches `rabbitmq`, `kafka`, `nats`; ports 5672/9092/4222 |
| `frontend` | image matches `nginx`, build context contains `frontend`/`web`; port 80/443/3000/5173 |
| `api` | exposes HTTP port and depends on a datastore |
| `worker` | no published ports, depends on queue/cache/db |
| `unknown` | none of the above. Shown as "unknown kind" |

Users can override the kind in the inspector.

### 6.4 Edge sources

| Edge type | Detection rule | Confidence |
|---|---|---|
| `declared` | `depends_on`, `links` | High (configuration) |
| `inferred:env` | env var value contains another service name as host (`redis://demo-redis:6379`, `DB_HOST=demo-postgres`) | Medium |
| `inferred:network` | Two services share a non-default network **and** no other evidence | Low (shown only on toggle) |
| `verified` | Set **only** by an experiment where the source's fault caused measurable impact on the target | Evidence-backed, links to experiment |

Each edge stores `reasons: list[str]`, e.g. `["env API.REDIS_URL = redis://demo-redis:6379"]`. The inspector shows these verbatim when the user asks "why does X affect Y?".

### 6.5 Predicted blast radius

For a selected service `S`, compute the set of services that **transitively depend on** `S` (reverse BFS over declared + inferred edges). Label the result **"Predicted impact (not verified)"**, with path explanations:

```
If demo-redis fails, predicted impact:
  demo-api     ← declared depends_on, env REDIS_URL
  demo-worker  ← env REDIS_HOST
  demo-frontend ← via demo-api (declared)
Status: PREDICTED. Run an experiment to verify.
```

### 6.6 Uncertainty banner

Always shown on the graph:

> Compose files describe configuration, not runtime behaviour. Calls made via external URLs, service discovery, or hard-coded hosts may not appear here. Edges marked *inferred* are heuristics. Only *verified* edges are backed by measurements.

---

## 7. Module B: BlastRadius Failure Simulator

### 7.1 Fault scenarios

| ID | Scenario | Mechanism | Reversible by | Priority |
|---|---|---|---|---|
| `stop_container` | Stop disposable Redis | `container.stop(timeout=5)` | `container.start()` | **P1** |
| `pause_container` | Freeze a service (hangs, not refuses) | `container.pause()` | `container.unpause()` | P2 |
| `stop_api_replica` | Stop test API service | `container.stop()` | `container.start()` | P2 |
| `latency` | Add N ms between api↔redis | Toxiproxy `latency` toxic | Remove toxic | P2 |
| `error_injection` | Return 503 for X% of requests | Demo API `/__chaos/errors?rate=` (test-only, token-protected, only enabled with `CHAOS_MODE=1`) | Reset endpoint | P2 |

**No scenario deletes volumes, removes containers, or modifies data.** `docker rm`, `volume rm`, `kill -9` on databases, and `network disconnect` on stateful services are not implemented.

### 7.2 Preflight check (runs before every experiment)

Every check must pass. The UI shows a checklist with pass/fail and the reason for each.

| # | Check | Fails when |
|---|---|---|
| 1 | Environment label | Target containers lack `blastradius.env=test` |
| 2 | Fault-target allowlist | Target container lacks `blastradius.fault-allowed=true` or is not in `FAULT_ALLOWLIST` |
| 3 | Production guard | Any container/env has `ENV`, `NODE_ENV`, `APP_ENV` = `prod`/`production`, or label `blastradius.env=production` |
| 4 | Network isolation | Target network is not the dedicated `br-target` bridge, or containers publish ports on `0.0.0.0` beyond the allowed set |
| 5 | Load target allowlist | Target URL host not in `LOAD_TARGET_ALLOWLIST` (default: `localhost`, `127.0.0.1`, `demo-api`, `*.test`) |
| 6 | Limits within hard caps | Requested RPS, VUs, duration exceed server-side caps |
| 7 | Target healthy at start | `/health` not returning 200 over 3 probes |
| 8 | No other experiment running | Concurrency lock held |
| 9 | Restore path available | Docker API reachable; container is restartable (has restart capability, not `--rm`) |

### 7.3 Experiment phases

```
│◀── BASELINE ──▶│◀──── FAULT ────▶│◀─────── RECOVERY ───────▶│
0s              20s               40s                   ≤ 40s + recovery_timeout
                 ▲ inject          ▲ restore            ▲ recovered (or "not recovered")
```

- Load runs continuously at a **constant** rate across all phases, so the comparison is controlled (same load, only the fault differs).
- Phase boundaries are recorded as timestamps; each metric bucket is tagged with its phase.
- **Kill switch:** `POST /experiments/{id}/abort` (and a big button in the UI). This stops k6 and restores **every** fault immediately, regardless of phase.
- **Watchdog:** a fault is always restored after `max_fault_duration_s` (hard cap 120s), even if the controller task crashes. Implementation: a separate `asyncio` task + a startup sweep that restores any container labelled `blastradius.faulted-by=<experiment_id>` left from a previous crash.

### 7.4 Measurements

Per 1-second bucket: requests, successes, failures (non-2xx + timeouts + connection errors, each counted separately), RPS, p50/p95/p99/max latency, per-endpoint breakdown, health-probe status of each service.

Per phase: aggregate of the above + delta vs baseline.

### 7.5 Recovery measurement

```
recovered_at = first time t after restore such that, for N consecutive seconds (default 5):
    error_rate(t) ≤ slo.max_error_rate  AND  p95(t) ≤ slo.p95_ms
recovery_time = recovered_at − restore_time
```

If this never happens within `recovery_timeout_s`, the report says **"Not recovered within 60s"**. It never says "recovered".

### 7.6 Impact attribution rules

A service is marked **observed impact** only if at least one of these is recorded:

| Evidence type | Rule |
|---|---|
| `request_errors` | Error rate of an endpoint attributed to the service rose by ≥ X percentage points vs baseline (default 5 pp) and the increase is outside baseline noise (> baseline mean + 3σ) |
| `latency_regression` | p95 rose ≥ 50% vs baseline **and** ≥ 50 ms absolute |
| `health_check` | Service `/health` (or Docker health status) changed to unhealthy during the fault |
| `log_signature` | (P2) Container logs contain error lines matching a configured pattern during the fault window but not in baseline |

Each evidence item stores the metric, baseline value, fault value, sample count, and time window. **Endpoint→service mapping** comes from the demo app's config (e.g. `/api/checkout` → `demo-api`, depends on `demo-redis`) and is shown to the user.

Services on a predicted path with no evidence stay **"predicted, not observed"**. If a predicted impact did **not** occur, that is reported too (e.g. "worker showed no measurable impact; no worker metrics were available, so this is unverified").

---

## 8. Module C: Traffic Twin Load Testing

### 8.1 Configuration

| Field | Default | Hard cap (server-enforced) |
|---|---|---|
| Target base URL | `http://demo-api:3000` | Must match allowlist |
| Endpoints | `GET /health`, `GET /api/products`, `GET /api/checkout-preview`, `GET /api/slow?ms=50` | Only GET; only paths from the target's declared endpoint list |
| Baseline RPS | 20 | — |
| Multipliers | `[1, 2, 5, 10]` | Max multiplier × baseline ≤ `MAX_RPS` (500) |
| Step duration | 20 s | Total duration ≤ 300 s |
| Ramp between steps | 5 s linear | — |
| Max VUs (concurrency) | 100 | 200 |
| Request timeout | 5 s | 10 s |
| Total request cap | computed | 100,000 |

The k6 script is generated from a template using the `ramping-arrival-rate` executor (an open model). The generated script is also shown in the UI for transparency.

### 8.2 Metrics

| Metric | Source | Availability |
|---|---|---|
| RPS, total, success, failed, error rate | k6 JSON stream | Always |
| p50 / p95 / p99 / max latency | Computed from raw samples (HDR-style or exact sort per bucket) | Always (p99 flagged "low sample count" if < 100 samples in window) |
| Dropped iterations | k6 `dropped_iterations` | Always. Signals the **generator** could not keep up, so results above that load are not trustworthy |
| CPU %, memory % per container | `docker stats` API (P1-lite) or cAdvisor (P2) | When Docker socket readable |
| DB active connections / max | `SELECT count(*) FROM pg_stat_activity` vs `max_connections` | When DB credentials for the **demo** DB are configured |
| Pool exhaustion | Demo API exposes `/metrics` with `pool_waiting_clients`, `pool_total` | Only when the app exposes them |

Any unavailable metric is stored as `null` with `status: "unavailable"` and a reason, and the UI shows "Not available: <reason>". It is never zero-filled.

### 8.3 SLOs

```yaml
slo:
  p95_ms: 300          # p95 latency must stay below
  max_error_rate: 0.01 # 1%
  min_rps_ratio: 0.95  # achieved RPS ≥ 95% of target RPS
```

Each is drawn as a horizontal reference line. A **breach** for a step is evaluated on the step's steady-state window (excluding the ramp seconds):

```
step_breached = p95 > slo.p95_ms
             OR error_rate > slo.max_error_rate
             OR achieved_rps < slo.min_rps_ratio × target_rps
```

The first breached step gets a marker on every chart with a tooltip naming which SLO(s) failed and the measured values.

### 8.4 Breaking point (experimental, never assumed)

```
highest_passing_load = max multiplier m among TESTED steps where step did not breach
first_breach_load     = min multiplier m among TESTED steps where step breached
```

Report wording, e.g.:

> Tested loads: 1×, 2×, 5×, 10× (20–200 RPS). Highest load meeting all SLOs: **5× (100 RPS)**. First breach: **10× (200 RPS)**, with p95 = 812 ms (> 300 ms). The true limit lies between 100 and 200 RPS. Not tested at finer granularity.

If no step breached: "No breach up to 10× (the highest tested load). Capacity limit is above 200 RPS and was not determined."

Optional **refine** mode (P2): binary search between the last pass and first breach with 2–3 extra steps.

### 8.5 Safety auto-stop

The runner aborts the test (and records why) when **any** of these is crossed for 5 consecutive seconds:

- error rate > `safety.max_error_rate` (default 50%)
- p95 > `safety.max_p95_ms` (default 5000 ms)
- target health endpoint fails 3× in a row
- elapsed > configured duration + 10 s grace
- total requests ≥ request cap

k6 `thresholds` with `abortOnFail: true` mirror these as a second, independent safety net.

### 8.6 Bottleneck classification (deterministic rules, P2)

Evaluated only at the first breached step, comparing against the baseline step:

| Classification | Required evidence |
|---|---|
| `cpu_bound` | Target container CPU ≥ 90% of its limit during breach |
| `memory_pressure` | Memory ≥ 90% of limit, or OOM kill / restart observed |
| `db_connection_exhaustion` | Active DB connections ≥ 90% of pool size **and** pool waiting clients > 0 |
| `downstream_latency` | Dependency (e.g. Redis/DB) latency metric rose while CPU < 70% |
| `load_generator_limited` | k6 `dropped_iterations` > 0 or generator CPU saturated, so **results are invalid**, not a target bottleneck |
| `unknown` | None of the above has sufficient data. **This is the default.** |

The report always lists which signals were available and which were missing.

---

## 9. The Unified Workflow (the differentiator)

One application, one graph, one timeline, two questions:

| Question | Experiment type | Controlled variable |
|---|---|---|
| **Resilience:** How does the app behave when a dependency fails? | `fault` (constant load, inject fault) | Fault on/off |
| **Capacity:** How does the app behave as request volume increases? | `capacity` (no fault, ramp load) | Load level |
| Combined (optional) | `fault_under_load` | **Both**, explicitly labelled |

### Example: the demo stack (frontend, Node API, Redis, PostgreSQL, worker)

1. **Baseline capacity run** (`capacity`, 1×): measures normal throughput, p95, errors.
2. **Redis failure run** (`fault`, constant 1× load): baseline 20s → stop Redis 20s → restore → recovery. The live view shows:
   1. The service under test (`demo-redis`, "Failure injected").
   2. The current load level (`1× · 20 RPS`).
   3. The architecture graph with `demo-api` turning "Observed impact" **only once** error evidence appears.
   4. p95 and error-rate deltas, per phase.
   5. Whether it recovers, and how long that takes.
   6. A side-by-side phase table: baseline vs fault vs recovery.
3. **Capacity ramp** (`capacity`, 1×→10×): finds the first SLO breach.

### Attribution rule for combined experiments

If a run has **both** a fault and a load change, every chart band and report section is labelled `FAULT + LOAD 5×`. The report states:

> This run changed two variables at once. Regressions in this run cannot be attributed to either cause alone. Compare with run #12 (fault only, 1×) and run #14 (5× load, no fault) for controlled comparisons.

The report generator **refuses** to emit a causal statement unless a controlled comparison run exists in history.

---

## 10. API Contracts and Pydantic Schemas

### 10.1 REST endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Control-plane health |
| `GET` | `/api/limits` | Server-enforced hard caps and allowlists (read-only) |
| `POST` | `/api/architecture/parse` | Upload/paste compose → `ArchitectureGraph` (multipart or JSON) |
| `GET` | `/api/architecture/{graph_id}` | Fetch a stored graph (incl. verified edges from experiments) |
| `GET` | `/api/architecture/{graph_id}/impact/{service}` | Predicted blast radius with paths |
| `POST` | `/api/experiments` | Create experiment (validates, runs preflight, returns `PENDING` or 422) |
| `POST` | `/api/experiments/{id}/preflight` | Re-run preflight |
| `POST` | `/api/experiments/{id}/start` | Start |
| `POST` | `/api/experiments/{id}/abort` | Kill switch: stop load, restore all faults |
| `GET` | `/api/experiments` | List (history) |
| `GET` | `/api/experiments/{id}` | Status + config + phase stats |
| `GET` | `/api/experiments/{id}/samples?from=&to=` | Time-series buckets |
| `GET` | `/api/reports/{experiment_id}` | Deterministic report |
| `GET` | `/api/reports/compare?a=&b=` | Run-vs-run comparison (P2) |
| `POST` | `/api/reports/{experiment_id}/explain` | Gemini explanation (P2; 503 if not configured) |
| `POST` | `/api/system/reset` | Restore all faulted containers + clear locks (recovery helper) |
| `WS` | `/ws/experiments/{id}` | Live stream: `state`, `phase`, `bucket`, `evidence`, `breach`, `log` messages |

### 10.2 Core schemas

```python
# backend/app/schemas/experiment.py
from datetime import datetime
from enum import Enum
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field, HttpUrl, model_validator


class ExperimentType(str, Enum):
    CAPACITY = "capacity"
    FAULT = "fault"
    FAULT_UNDER_LOAD = "fault_under_load"


class ExperimentState(str, Enum):
    PENDING = "pending"
    PREFLIGHT_FAILED = "preflight_failed"
    RUNNING = "running"
    COMPLETED = "completed"
    ABORTED = "aborted"           # user kill switch
    AUTO_STOPPED = "auto_stopped" # safety threshold
    FAILED = "failed"             # internal error


class Phase(str, Enum):
    BASELINE = "baseline"
    FAULT = "fault"
    RECOVERY = "recovery"
    LOAD_STEP = "load_step"


class SLO(BaseModel):
    p95_ms: float = Field(300, gt=0, le=60_000)
    max_error_rate: float = Field(0.01, ge=0, le=1)
    min_rps_ratio: float = Field(0.95, gt=0, le=1)


class SafetyLimits(BaseModel):
    max_error_rate: float = Field(0.5, gt=0, le=1)
    max_p95_ms: float = Field(5000, gt=0, le=60_000)
    consecutive_seconds: int = Field(5, ge=1, le=60)


class LoadConfig(BaseModel):
    target_base_url: HttpUrl
    endpoints: list[str] = Field(min_length=1, max_length=10)  # paths only, GET only
    baseline_rps: int = Field(20, ge=1, le=500)
    multipliers: list[float] = Field(default=[1.0], min_length=1, max_length=8)
    step_duration_s: int = Field(20, ge=5, le=120)
    ramp_s: int = Field(5, ge=0, le=30)
    max_vus: int = Field(100, ge=1, le=200)
    request_timeout_s: float = Field(5, gt=0, le=10)

    @model_validator(mode="after")
    def check_caps(self):
        if any(m <= 0 for m in self.multipliers):
            raise ValueError("multipliers must be positive")
        if self.multipliers != sorted(self.multipliers):
            raise ValueError("multipliers must be ascending")
        if max(self.multipliers) * self.baseline_rps > 500:
            raise ValueError("peak RPS exceeds hard cap of 500")
        total = len(self.multipliers) * (self.step_duration_s + self.ramp_s)
        if total > 300:
            raise ValueError(f"total duration {total}s exceeds hard cap of 300s")
        for p in self.endpoints:
            if not p.startswith("/") or "://" in p:
                raise ValueError(f"endpoint '{p}' must be a path like /api/x")
        return self


class FaultKind(str, Enum):
    STOP_CONTAINER = "stop_container"
    PAUSE_CONTAINER = "pause_container"   # P2
    LATENCY = "latency"                   # P2


class FaultConfig(BaseModel):
    kind: FaultKind
    target_service: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$")
    baseline_s: int = Field(20, ge=5, le=120)
    fault_s: int = Field(20, ge=5, le=120)
    recovery_timeout_s: int = Field(60, ge=10, le=180)
    recovery_stable_s: int = Field(5, ge=1, le=30)
    latency_ms: int | None = Field(None, ge=1, le=5000)  # LATENCY only


class ExperimentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: ExperimentType
    graph_id: UUID | None = None
    load: LoadConfig
    fault: FaultConfig | None = None
    slo: SLO = SLO()
    safety: SafetyLimits = SafetyLimits()

    @model_validator(mode="after")
    def fault_matches_type(self):
        needs_fault = self.type in (ExperimentType.FAULT, ExperimentType.FAULT_UNDER_LOAD)
        if needs_fault and self.fault is None:
            raise ValueError(f"experiment type '{self.type.value}' requires a fault config")
        if not needs_fault and self.fault is not None:
            raise ValueError("capacity experiments must not include a fault")
        if self.type == ExperimentType.FAULT and len(self.load.multipliers) != 1:
            raise ValueError("fault experiments use a single constant load level "
                             "(use fault_under_load to vary both, explicitly labelled)")
        return self


class PreflightCheck(BaseModel):
    id: str
    label: str
    passed: bool
    detail: str


class PreflightResult(BaseModel):
    passed: bool
    checks: list[PreflightCheck]
```

```python
# backend/app/schemas/metrics.py
class MetricStatus(str, Enum):
    OK = "ok"
    UNAVAILABLE = "unavailable"
    LOW_SAMPLE = "low_sample"


class OptionalMetric(BaseModel):
    value: float | None
    status: MetricStatus
    reason: str | None = None  # required when unavailable


class MetricBucket(BaseModel):
    t: datetime                 # bucket start (1s)
    elapsed_s: float
    phase: Phase
    load_multiplier: float
    target_rps: float
    requests: int
    successes: int
    failures: int
    timeouts: int
    rps: float
    error_rate: float
    p50_ms: float | None
    p95_ms: float | None
    p99_ms: OptionalMetric
    max_ms: float | None
    cpu_pct: dict[str, OptionalMetric]      # by service
    mem_pct: dict[str, OptionalMetric]
    db_connections: OptionalMetric
    health: dict[str, Literal["healthy", "unhealthy", "unknown"]]


class PhaseStats(BaseModel):
    phase: Phase
    load_multiplier: float
    start: datetime
    end: datetime
    requests: int
    error_rate: float
    rps: float
    p50_ms: float | None
    p95_ms: float | None
    p99_ms: OptionalMetric
    max_ms: float | None
    slo_breaches: list[Literal["p95", "error_rate", "throughput"]]


class Evidence(BaseModel):
    service: str
    kind: Literal["request_errors", "latency_regression", "health_check", "log_signature"]
    metric: str
    baseline_value: float | None
    observed_value: float | None
    window_start: datetime
    window_end: datetime
    sample_count: int
    detail: str
```

```python
# backend/app/schemas/graph.py
class ServiceKind(str, Enum):
    FRONTEND = "frontend"; API = "api"; DATABASE = "database"
    CACHE = "cache"; QUEUE = "queue"; WORKER = "worker"; UNKNOWN = "unknown"


class EdgeSource(str, Enum):
    DECLARED = "declared"
    INFERRED_ENV = "inferred:env"
    INFERRED_NETWORK = "inferred:network"
    VERIFIED = "verified"


class ServiceNode(BaseModel):
    id: str
    kind: ServiceKind
    kind_inferred: bool
    image: str | None
    ports: list[str]
    healthcheck: bool
    labels: dict[str, str]
    fault_allowed: bool          # from label blastradius.fault-allowed
    unanalysed_keys: list[str]


class DependencyEdge(BaseModel):
    source: str                  # dependent (e.g. demo-api)
    target: str                  # dependency (e.g. demo-redis)
    sources: list[EdgeSource]
    reasons: list[str]
    verified_by: list[UUID] = [] # experiment IDs


class ArchitectureGraph(BaseModel):
    id: UUID
    name: str
    nodes: list[ServiceNode]
    edges: list[DependencyEdge]
    warnings: list[str]
    uncertainty_note: str
```

```python
# backend/app/schemas/report.py
class Recommendation(BaseModel):
    priority: Literal["P1", "P2", "P3"]
    title: str
    rationale: str
    evidence_refs: list[int]     # indexes into report.evidence


class Report(BaseModel):
    experiment_id: UUID
    generated_at: datetime
    data_source: Literal["live", "recorded"]  # recorded = replayed fallback
    config: ExperimentCreate
    final_state: ExperimentState
    stop_reason: str | None
    phases: list[PhaseStats]
    baseline_vs_fault: dict[str, float | None] | None   # deltas
    recovery_time_s: float | None
    recovered: bool | None
    highest_passing_multiplier: float | None
    first_breach_multiplier: float | None
    tested_multipliers: list[float]
    bottleneck: Literal["cpu_bound", "memory_pressure", "db_connection_exhaustion",
                        "downstream_latency", "load_generator_limited", "unknown"]
    bottleneck_evidence: list[str]
    affected_services: list[str]          # verified only
    predicted_not_observed: list[str]
    evidence: list[Evidence]
    limitations: list[str]
    missing_metrics: list[str]
    recommendations: list[Recommendation]
    confounded: bool                      # true for fault_under_load
    ai_summary: str | None = None         # labelled "AI-generated" in UI
```

### 10.3 WebSocket messages

```jsonc
{ "type": "state",    "state": "running" }
{ "type": "phase",    "phase": "fault", "at": "2026-10-29T10:00:20Z", "detail": "Stopped demo-redis" }
{ "type": "bucket",   "data": { /* MetricBucket */ } }
{ "type": "evidence", "data": { /* Evidence */ } }
{ "type": "breach",   "elapsed_s": 64.0, "multiplier": 10, "slos": ["p95"], "values": { "p95_ms": 812 } }
{ "type": "log",      "level": "warn", "msg": "Safety auto-stop: error rate 63% > 50% for 5s" }
```

---

## 11. Data Model (PostgreSQL)

```sql
CREATE TABLE architecture_graphs (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  source_yaml TEXT NOT NULL,
  graph JSONB NOT NULL,              -- ArchitectureGraph
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE experiments (
  id UUID PRIMARY KEY,
  graph_id UUID REFERENCES architecture_graphs(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  config JSONB NOT NULL,             -- ExperimentCreate (immutable once started)
  preflight JSONB,
  data_source TEXT NOT NULL DEFAULT 'live',
  stop_reason TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE phase_markers (
  id BIGSERIAL PRIMARY KEY,
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  load_multiplier REAL NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  detail TEXT
);

CREATE TABLE metric_buckets (
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  t TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,               -- MetricBucket
  PRIMARY KEY (experiment_id, t)
);

CREATE TABLE evidence (
  id BIGSERIAL PRIMARY KEY,
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  data JSONB NOT NULL                -- Evidence
);

CREATE TABLE reports (
  experiment_id UUID PRIMARY KEY REFERENCES experiments(id) ON DELETE CASCADE,
  report JSONB NOT NULL,             -- Report
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Raw k6 samples are aggregated in memory into 1s buckets. They are **not** stored individually, which keeps the DB small. The raw JSON is optionally kept as a gzip file per experiment for audit.

---

## 12. Safety Model

| Layer | Control |
|---|---|
| **Network exposure** | Backend binds `127.0.0.1:8000` by default; dashboard on `127.0.0.1:5173`. No public load-test endpoint. A non-loopback bind requires `BLASTRADIUS_ALLOW_REMOTE=1` **and** an API token. |
| **Load targets** | Hostname allowlist (`LOAD_TARGET_ALLOWLIST`), resolved IP must be loopback/private (RFC1918) or a Docker network IP. Redirects are not followed. GET only. Paths are validated. |
| **Fault targets** | Container must be on `FAULT_ALLOWLIST` **and** carry labels `blastradius.env=test` and `blastradius.fault-allowed=true`. Database containers are never fault targets in the MVP. |
| **Production guard** | Any `production`/`prod` env marker aborts preflight. No override flag exists in the hackathon build. |
| **Hard limits** | Enforced in Pydantic **and** re-checked in the runner **and** encoded in k6 options: RPS ≤ 500, VUs ≤ 200, duration ≤ 300 s, requests ≤ 100k, timeout ≤ 10 s. |
| **Auto-stop** | Safety thresholds (§8.5) + k6 `abortOnFail` thresholds. |
| **Manual stop** | Kill switch in the UI header on every page; `POST /abort`; `make reset`. |
| **Guaranteed restore** | Watchdog timer per fault, `finally:` restore in controller, startup sweep for `blastradius.faulted-by` labels. |
| **Non-destructive** | Only stop/start/pause/unpause and proxy toxics. No `rm`, no volume operations, no data writes. |
| **No real data** | Synthetic requests only, from templates. No request replay feature exists. Demo DB is seeded with fake data. |
| **No arbitrary code** | k6 scripts are generated from a fixed template; user input is JSON-escaped into it. |
| **One at a time** | A global lock prevents concurrent experiments. |

### Recovery instructions (shown in UI and README)

If anything looks stuck:

1. Click **Stop experiment** (or `curl -X POST localhost:8000/api/experiments/<id>/abort`).
2. If the backend is down: `make reset`, which runs `docker start $(docker ps -aq --filter label=blastradius.fault-allowed=true)` and `docker unpause` on the same set.
3. Verify: `curl localhost:3000/health` on the demo API returns `{"status":"ok","redis":"ok","db":"ok"}`.

---

## 13. Demo Application

Purpose: make results **demonstrable and repeatable**, not feature-rich.

### 13.1 Services

| Service | Tech | Role | Fault-allowed |
|---|---|---|---|
| `demo-frontend` | React (static, nginx) | Tiny storefront page that calls the API | No |
| `demo-api` | Node.js 20 + Express, `pg` pool, `ioredis` | Endpoints below | P2 (stop) |
| `demo-redis` | `redis:7-alpine` | Session/cart cache | **Yes (P1)** |
| `demo-postgres` | `postgres:16-alpine` | Products, synthetic orders | **No** (never faulted) |
| `demo-worker` | Node.js | Pulls jobs from a Redis list, writes to Postgres | No |

### 13.2 Endpoints (all synthetic)

| Endpoint | Behaviour | Depends on | Used for |
|---|---|---|---|
| `GET /health` | `{status, redis, db}`; 200 only if all ok, else 503 | redis, postgres | Health probes, recovery |
| `GET /health/live` | Always 200 if the process is up | none | Distinguish "process up" vs "deps up" |
| `GET /api/products` | `SELECT … LIMIT 20` from Postgres | postgres | DB-bound load |
| `GET /api/cart/:id` | Redis `GET`; **no fallback**, so 503 on Redis error | redis | **Clear Redis fault signal** |
| `GET /api/checkout-preview` | Reads cart from Redis + prices from Postgres | redis, postgres | Realistic mixed path |
| `GET /api/products-cached` | Redis cache with **DB fallback** on Redis error (slower, but succeeds) | redis (soft), postgres | Shows graceful degradation: latency rises, errors don't |
| `GET /api/slow?ms=N` | `setTimeout(N)` capped at 2000 | none | Predictable latency baseline |
| `GET /api/cpu?iterations=N` | Bounded CPU loop (capped) | none | Reproducible CPU bottleneck |
| `GET /metrics` | Prometheus format: request counters, histograms, `pg_pool_total`, `pg_pool_idle`, `pg_pool_waiting` | none | Pool exhaustion diagnosis |

`pg` pool `max` is set deliberately low (`PG_POOL_MAX=10`) so the capacity ramp produces a **reproducible, measurable** DB connection-pool breach at a modest RPS, which is good for a live demo.

### 13.3 `demo-app/compose.yaml` (the file uploaded in the demo)

```yaml
name: blastradius-demo

services:
  demo-frontend:
    build: ./frontend
    ports: ["127.0.0.1:8080:80"]
    depends_on: [demo-api]
    labels:
      blastradius.env: test
    networks: [br-target]

  demo-api:
    build: ./api
    ports: ["127.0.0.1:3000:3000"]
    environment:
      NODE_ENV: test
      REDIS_URL: redis://demo-redis:6379
      DATABASE_URL: postgres://demo:demo@demo-postgres:5432/demo
      PG_POOL_MAX: "10"
    depends_on:
      demo-redis: { condition: service_healthy }
      demo-postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health/live"]
      interval: 5s
      timeout: 2s
      retries: 3
    labels:
      blastradius.env: test
      blastradius.fault-allowed: "true"
    networks: [br-target]

  demo-redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 2s
      retries: 3
    labels:
      blastradius.env: test
      blastradius.fault-allowed: "true"
    networks: [br-target]

  demo-postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: demo
      POSTGRES_PASSWORD: demo        # local demo-only credential, synthetic data
      POSTGRES_DB: demo
    volumes:
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U demo"]
      interval: 5s
      timeout: 2s
      retries: 5
    labels:
      blastradius.env: test
    networks: [br-target]

  demo-worker:
    build: ./worker
    environment:
      REDIS_HOST: demo-redis
      DATABASE_URL: postgres://demo:demo@demo-postgres:5432/demo
    labels:
      blastradius.env: test
    networks: [br-target]

networks:
  br-target:
    name: br-target
    driver: bridge
```

Note the deliberate teaching moments: `demo-worker` has **no** `depends_on`, so its Redis/Postgres edges are **inferred** from env vars. The graph shows them as dashed with reasons, which demonstrates the declared/inferred distinction live.

### 13.4 Expected (hypothesised, to be measured) demo behaviour

> The following are **hypotheses** used to design the demo, not results. Real values come from runs.

| Scenario | Hypothesis |
|---|---|
| Redis stopped | `/api/cart/:id` and `/api/checkout-preview` errors rise sharply; `/api/products` unaffected; `/api/products-cached` latency rises but errors stay low; `/health` → 503 |
| Redis restored | ioredis reconnects; errors return to baseline within a few seconds |
| Load ramp | `/api/products` p95 rises once concurrent requests exceed `PG_POOL_MAX=10`; `pg_pool_waiting > 0` signals pool exhaustion |

---

## 14. Dashboard Design

### 14.1 Visual language

- **Restrained dark theme:** background `#0B0D10`, surfaces `#12151A` / `#181C22`, borders `#262B33`, text `#E6E8EB` / muted `#8B929C`.
- **Type:** Inter for UI, JetBrains Mono for numbers, metrics, and YAML. Tabular numerals for all metrics.
- **No glow, no gradients-for-decoration, no fake sparkline filler.** Every button does something.
- **Accent:** one blue (`#4C8DFF`) for interactive elements only.

### 14.2 Status system (never colour alone)

| State | Colour | Icon | Text label | Border style |
|---|---|---|---|---|
| Healthy | Green `#3FB950` | ● filled circle | `HEALTHY` | solid |
| Under test | Blue `#4C8DFF` | ◎ ring | `UNDER TEST` | solid, 2px |
| Failure injected | Red `#F85149` | ✕ | `FAULT INJECTED` | solid, 2px |
| Observed impact | Amber `#D29922` | ▲ triangle | `IMPACT OBSERVED` | solid |
| Recovered | Teal `#2EA0A0` | ↺ | `RECOVERED · 4.2s` | solid |
| Unknown / unverified | Grey `#6E7681` | ? | `UNVERIFIED` | dashed |

Each node has an `aria-label` like "demo-api, API service, impact observed: error rate 0.2% to 91%".

### 14.3 Pages

**Overview (main dashboard)**
- Top bar: app name, environment badge (`TEST · isolated`), **global Stop button** (enabled only while running).
- Metric tiles: Application status · Current experiment state · Current RPS · p95 · Error rate · Active fault · Recovery status.
- Last experiment card with link to its report.
- History list (P2).

**Architecture workspace**
- Left: upload / paste YAML, validation errors inline with line numbers.
- Centre: React Flow graph (dagre layout), legend, toggles for inferred-network edges.
- Right inspector (on node click): kind (and whether inferred), image, ports, health check, labels, **dependencies**, **dependents**, **predicted blast radius with paths**, **verified impacts with links to evidence**, "Run failure experiment on this service" (enabled only if `fault_allowed`).

**Experiment view (live run: the unified screen)**
- Header strip: `Service under test: demo-redis · Fault: STOP · Load: 1× (20 RPS) · Phase: FAULT 00:12 / 00:20`.
- Phase timeline bar (baseline / fault / recovery) with the current position.
- Left half: graph with live states.
- Right half: stacked charts sharing the time axis: RPS (target vs achieved), latency (p50/p95/p99 + SLO line), error rate (+ SLO line). Phase bands as shaded `ReferenceArea`s with text labels.
- Evidence feed: each new evidence item as a row ("demo-api · request_errors · /api/cart error rate 0.0% → 93.8% · n=412").

**Traffic Twin workspace**
- Config form (target from allowlist dropdown, endpoints checkboxes, baseline RPS, multiplier chips, step duration, VUs, timeout, SLOs). Live validation against `/api/limits`.
- Generated k6 script preview (read-only, collapsible).
- Charts with step bands, SLO lines, **breach markers**.
- Summary card: "Highest load passing all SLOs: **5× (100 RPS)** · First breach: **10×** (p95)" or "No breach up to tested max".
- Resource panel: CPU/mem/DB connections per service, or "Not available: <reason>".

**Report**
- Configuration (collapsible JSON).
- Phase comparison table: Baseline | Fault | Recovery (or per load step), with deltas and SLO pass/fail.
- Affected services (verified), each with evidence.
- Predicted but not observed.
- Recovery: time or "not recovered".
- Capacity: tested levels, highest passing, first breach.
- Bottleneck: classification + evidence, or `unknown` + missing signals.
- Limitations & missing metrics.
- Prioritised recommendations.
- Data-source badge: `LIVE` or `RECORDED`.
- Export as Markdown / JSON.

### 14.4 Recommendation rules (deterministic)

| Trigger (from evidence) | Recommendation |
|---|---|
| Redis fault → endpoint errors > 50% | P1: Add cache fallback / circuit breaker for `<endpoint>`; treat Redis as a soft dependency |
| `/health` returns 503 when a soft dependency is down | P2: Split liveness vs readiness so orchestrators don't restart healthy processes |
| Recovery time > 10s or not recovered | P1: Check client reconnect/backoff settings (`ioredis` `retryStrategy`) |
| DB pool exhaustion at first breach | P1: Tune pool size vs DB `max_connections`; add query timeouts; consider a read cache |
| CPU-bound at first breach | P2: Profile hot path; scale horizontally; set CPU limits/requests |
| `load_generator_limited` | P1: Results above this load are invalid; give k6 more resources |
| Bottleneck `unknown` | P2: Enable `/metrics` and cAdvisor so the cause can be identified |

---

## 15. Interfaces: CLI and Web Dashboard

BlastRadius ships with **two interfaces to one engine**:

- **`blastradius` CLI:** for terminals, scripts, and CI/CD pipelines.
- **Web dashboard:** for visual exploration, live graphs, and demos.

### 15.1 Principle: one engine, two front-ends

All experiment logic lives in the FastAPI control plane: parsing, preflight, limits, load and fault orchestration, metrics, analysis, and reports. The CLI and the dashboard are **thin clients** over the same REST and WebSocket API. As a result:

- **Same safety:** a CLI run passes the exact same preflight, allowlists, and hard caps as a dashboard run. The CLI cannot bypass them.
- **Same numbers:** both read the same stored measurements. A report looks identical in either interface.
- **Shared live state:** start a run from the CLI and watch it live in the dashboard, or start it in the dashboard and follow it in the terminal. A stop from either one aborts it.

```mermaid
flowchart LR
    CLI["blastradius CLI<br/>(Typer + Rich)"]
    WEB["Web Dashboard<br/>(React)"]
    CI["CI pipeline<br/>(GitHub Actions, etc.)"]
    API["FastAPI Control Plane<br/>REST + WebSocket"]
    ENGINE["Engine<br/>parser · graph · preflight · controller<br/>k6 runner · fault injector · metrics · reports"]
    DB[("PostgreSQL")]

    CI --> CLI
    CLI -->|"REST + WS"| API
    WEB -->|"REST + WS"| API
    API --> ENGINE --> DB
    CLI -.->|"offline: parse / impact only"| ENGINE
```

**Offline exception:** `blastradius parse` and `blastradius impact` import the same parser and graph modules directly. They work without a running server because they only read a file and touch neither Docker nor the database. Every command that sends traffic or injects faults **requires** the control plane, so safety checks can't be skipped.

### 15.2 Which interface for what

| Task | CLI | Dashboard |
|---|---|---|
| Validate a Compose file | ✅ `parse` (offline, CI-friendly) | ✅ Upload + inline errors |
| View the dependency graph | ✅ Tree + edge table in the terminal | ✅ **Interactive React Flow graph** (best) |
| Predicted blast radius | ✅ `impact` | ✅ Inspector panel |
| Run load test / capacity ramp | ✅ `load run` with live terminal table | ✅ Live charts |
| Run a fault experiment | ✅ `fault run` with phase bar | ✅ Live graph + charts |
| Declarative experiment from a file | ✅ `run -f experiment.yaml` (**best for CI**) | Import the same YAML (P2) |
| Stop a running test | ✅ `Ctrl+C` or `abort` | ✅ Global Stop button |
| Pass/fail gate in CI | ✅ **Exit codes** | — |
| Reports | ✅ Markdown/JSON export | ✅ Rich report page |
| History and comparison | ✅ `list`, `compare` (P2) | ✅ History page (P2) |

### 15.3 Technology

| Concern | Choice | Reason |
|---|---|---|
| Command framework | **Typer** | Type-hinted commands, auto `--help`, same Python as the backend |
| Terminal UI | **Rich** (`Live`, `Table`, `Tree`, `Progress`) | Live-updating tables, phase bars, coloured status **plus text labels** |
| HTTP / WS | `httpx` + `websockets` | Async, with timeouts |
| Schemas | Imports `app.schemas` from the backend package | One source of truth; CLI and server can't drift apart |
| Install | Console entry point in `backend/pyproject.toml`: `blastradius = "app.cli.main:app"` | `pip install -e backend` gives the `blastradius` command |

### 15.4 Command reference

```text
blastradius up                       Start control plane + demo app (wraps docker compose)
blastradius down                     Stop them (restores any faulted containers first)
blastradius status                   Control plane health, running experiment, limits

blastradius parse <compose.yaml>     Validate + print services and edges   [offline]
    --json                           Machine-readable ArchitectureGraph
    --show-inferred-network          Include low-confidence network edges
blastradius impact <compose.yaml> --service <name>
                                     Predicted blast radius with paths      [offline]

blastradius load run                 Capacity test / load ramp
    --target URL                     Must be on the server allowlist
    --endpoint PATH                  Repeatable (e.g. --endpoint /api/products)
    --rps N                          Baseline RPS
    --multipliers 1,2,5,10           Load steps
    --step 20s --ramp 5s --vus 100 --timeout 5s
    --slo-p95 300ms --slo-errors 1% --slo-min-rps 95%

blastradius fault run                Resilience test (constant load + one fault)
    --service demo-redis --kind stop
    --rps 20 --baseline 20s --fault 20s --recovery-timeout 60s
    --target URL --endpoint PATH ...

blastradius run -f experiment.yaml   Run any experiment defined in a file
blastradius preflight -f experiment.yaml
                                     Run safety checks only (no traffic, no faults)

blastradius abort [ID]               Kill switch (defaults to the running experiment)
blastradius reset                    Restore every faulted container and clear locks

blastradius list [--limit 20]        Experiment history
blastradius show <ID>                Status, config, phase stats
blastradius report <ID>              Print the report
    --format md|json  -o FILE        Export
blastradius open <ID>                Open this experiment in the web dashboard
blastradius compare <A> <B>          Run-vs-run comparison                  [P2]
blastradius explain <ID>             Gemini summary (needs GEMINI_API_KEY)   [P2]

Global flags:
    --server URL                     Default http://127.0.0.1:8000 (env BLASTRADIUS_URL)
    --token TOKEN                    Only when the server allows remote access
    --json                           JSON output, no colours or live UI
    --no-live                        Plain progress lines (good for CI logs)
    -q / -v                          Quiet / verbose
```

### 15.5 Declarative experiment file

The same schema as `ExperimentCreate` (§10.2), written as YAML, so it can live in the repo next to the app:

```yaml
# experiments/redis-outage.yaml
name: redis-outage-at-baseline
type: fault
load:
  target_base_url: http://demo-api:3000
  endpoints: [/api/cart/1, /api/products, /api/checkout-preview]
  baseline_rps: 20
  multipliers: [1]
  step_duration_s: 60
fault:
  kind: stop_container
  target_service: demo-redis
  baseline_s: 20
  fault_s: 20
  recovery_timeout_s: 60
slo:
  p95_ms: 300
  max_error_rate: 0.01
```

### 15.6 Live terminal view (mock-up)

The layout is illustrative. Numbers come from the live stream, never from fixed values.

```text
BlastRadius · redis-outage-at-baseline · exp 7f3c…          TEST · isolated
Service under test: demo-redis   Fault: STOP   Load: 1× (20 RPS target)

Phase  [■■■■■■■ BASELINE ■■■■■■■|▓▓▓▓▓ FAULT ▓▓▓▓▓|░░ RECOVERY ░░        ]  00:31

             RPS      p50      p95      p99      Errors    SLO
Baseline    20.0     <val>    <val>    <val>     <val>     PASS
Fault       19.8     <val>    <val>    <val>     <val>     FAIL (errors)
Now         20.1     <val>    <val>    <val>     <val>

Services
  ✕ demo-redis      FAULT INJECTED
  ▲ demo-api        IMPACT OBSERVED   /api/cart error rate <base> → <fault> (n=<count>)
  ? demo-worker     UNVERIFIED        no worker metrics available
  ● demo-postgres   HEALTHY

Ctrl+C to abort (restores demo-redis)
```

### 15.7 Exit codes (CI gating)

| Code | Meaning |
|---|---|
| `0` | Experiment completed and **all SLOs passed** (and, for fault runs, the system recovered) |
| `1` | Completed, but an SLO was breached or the system did not recover |
| `2` | Preflight failed (unsafe or unauthorised target, prod marker, limits) |
| `3` | Aborted by the user or auto-stopped by a safety threshold |
| `4` | Invalid configuration (YAML or schema error) |
| `5` | Control plane unreachable or internal error |

### 15.8 CI example (GitHub Actions)

```yaml
name: resilience-gate
on: [pull_request]
jobs:
  blastradius:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install -e backend
      - run: blastradius up
      - run: blastradius parse demo-app/compose.yaml
      - run: blastradius run -f experiments/redis-outage.yaml --no-live
      - run: blastradius run -f experiments/capacity-ramp.yaml --no-live
      - if: always()
        run: blastradius report latest --format md -o blastradius-report.md
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: blastradius-report, path: blastradius-report.md }
      - if: always()
        run: blastradius down
```

The CI job runs against a demo/test stack started inside the CI runner. It never points at a shared or production environment.

### 15.9 CLI safety rules

- **Ctrl+C means abort:** the first Ctrl+C calls `POST /abort` and waits (max 10 s) for the restore confirmation. A second Ctrl+C exits immediately, prints the `blastradius reset` command, and returns exit code `3`.
- **No local load generation:** the CLI never runs k6 itself. All traffic goes through the control plane's limits.
- **No overrides:** the CLI has no `--force` or `--skip-preflight` flag.
- **Lost connection:** if the CLI disconnects mid-run, the experiment keeps running under the server's watchdog and restores on schedule. `blastradius status` reconnects to it.

---

## 16. Optional AI Features (Gemini)

**Status: P2, supplementary only.**

| Feature | Input sent to Gemini | Output |
|---|---|---|
| Explain why a failure matters | The `Report` JSON (evidence, phase stats) | Plain-language paragraph |
| Summarise architecture | `ArchitectureGraph` JSON | Short summary, with edge confidence levels preserved |
| Remediation phrasing | Deterministic recommendations + evidence | Expanded explanation per recommendation |
| Compare two runs | Two `Report` JSONs | Plain-language diff |

**Guardrails**

- The system prompt requires the model to use **only** numbers present in the input, to label predictions as predictions, and to say "not measured" when data is missing.
- **Post-check:** every number in the AI output is extracted and checked against the input JSON (tolerance for rounding). If any number is unmatched, the output is discarded and the UI shows "AI summary unavailable (failed grounding check)".
- AI text is always rendered in a box labelled **"AI-generated summary. Verify against the measurements above."**
- `GEMINI_API_KEY` unset → endpoint returns 503, UI hides the button, and everything else works.
- Sends only experiment metadata and metrics; no source code, secrets, or env values. Compose env values are redacted before sending.

---

## 17. Testing and Validation

### 17.1 Test matrix

| # | Requirement | Test | Type | Location |
|---|---|---|---|---|
| T1 | Compose parser reads supported config | Parse `fixtures/demo-compose.yaml` → 5 services, ports, healthchecks, labels | Unit | `tests/unit/test_compose_parser.py` |
| T2 | Short + long `depends_on` forms | Both produce identical declared edges | Unit | same |
| T3 | Graph represents parsed relationships | Declared edges match `depends_on`; `demo-worker` edges are `inferred:env` with reasons | Unit | `test_graph_builder.py` |
| T4 | Predicted blast radius | Redis → {api, worker, frontend} with correct paths | Unit | same |
| T5 | Invalid config → helpful errors | Bad YAML, missing services, unknown dep, cycle, oversize, each asserts message text | Unit | `test_compose_parser.py` |
| T6 | Percentiles correct | Known sample set → exact p50/p95/p99 | Unit | `test_metrics.py` |
| T7 | Collected metrics match test results | Feed recorded k6 JSON fixture → bucket totals equal line counts; error count equals non-2xx count | Unit | same |
| T8 | SLO breach detection | Synthetic step stats → correct first breach, highest pass, "no breach" case | Unit | `test_analysis.py` |
| T9 | Recovery measured, not assumed | Series that recovers at t=7s → 7s; series that never recovers → `recovered=False` | Unit | same |
| T10 | Hard limits | `LoadConfig` over caps → `ValidationError`; runner re-check rejects tampered config | Unit | `test_limits.py` |
| T11 | Unauthorised fault targets rejected | Container without labels, prod env, not on allowlist, database kind → preflight fails | Unit (mock Docker) | `test_preflight.py` |
| T12 | Load target allowlist | `http://example.com`, `http://169.254.169.254`, redirect to external → rejected | Unit | same |
| T13 | Missing metrics reported unavailable | No Docker socket → `cpu_pct` status `unavailable` with reason, never `0` | Unit | `test_metrics.py` |
| T14 | Report uses recorded results only | Report built from DB fixtures; every numeric field traceable to stored buckets | Unit | `test_report_builder.py` |
| T15 | Confounded runs flagged | `fault_under_load` → `confounded=True`, no causal statement | Unit | same |
| T16 | AI grounding check | Output with an invented number → rejected | Unit | `test_ai_explainer.py` |
| T17 | Load runner sends real requests | Run 5s at 10 RPS against demo API; demo API request counter delta ≈ k6 total (±2%) | **Integration** | `tests/integration/test_load_runner.py` |
| T18 | Cancellation works | Start 60s test, abort at 3s → k6 process gone within 2s, state `ABORTED`, request counter stops increasing | Integration | `test_cancel.py` |
| T19 | Fault produces measurable impact | Stop Redis under load → `/api/cart` error rate in fault phase > 50%; evidence recorded for `demo-api` | Integration | `test_fault_redis.py` |
| T20 | Restore + recovery | After restore, Redis container running, recovery time recorded (or `not recovered`) | Integration | same |
| T21 | Abort restores faults | Abort during fault phase → Redis running again | Integration | same |
| T22 | Safety auto-stop | Target `/api/slow?ms=2000` with `max_p95_ms=500` → `AUTO_STOPPED` with reason | Integration | `test_safety.py` |
| T23 | Frontend status badges | Each state renders text label + icon (not only colour) | Component (Vitest + Testing Library) | `frontend/src/components/**/*.test.tsx` |
| T24 | CLI `parse` works offline | Valid file → exit 0 + same graph JSON as `POST /api/architecture/parse`; invalid file → exit 4 + same error text | Unit (Typer `CliRunner`) | `tests/unit/test_cli.py` |
| T25 | CLI exit codes | Mocked server responses for pass, breach, preflight fail, abort, unreachable → exit 0/1/2/3/5 | Unit | same |
| T26 | CLI cannot bypass safety | Over-cap flags → server 422 → exit 2/4; no `--force` option exists | Unit | same |
| T27 | Ctrl+C aborts and restores | SIGINT during fault phase → `/abort` called, Redis running again, exit 3 | Integration | `tests/integration/test_cli_abort.py` |
| T28 | CLI and dashboard parity | Run started via CLI is visible on `GET /api/experiments` and streams on the same WS | Integration | same |

Integration tests require `docker compose -f demo-app/compose.yaml up -d` and are marked `@pytest.mark.integration`.

### 17.2 Commands

```bash
make test-unit
```

```bash
make test-integration
```

```bash
cd frontend && npm test
```

### 17.3 Results

**No tests have been run yet. No code exists.** Results will be recorded here as:

```
| Suite | Passed | Failed | Skipped | Date | Notes |
```

Any acceptance criterion not covered by a passing test will be listed under §18 as incomplete.

---

## 18. Implementation Status

Legend: ✅ Implemented & tested · 🟡 Implemented, not tested · 🧪 Simulated / recorded data · 📋 Planned · ⛔ Cut

| Feature | Priority | Status |
|---|---|---|
| Compose parser + validation | P0 | 📋 Planned |
| Dependency graph (declared + inferred) | P0 | 📋 Planned |
| React Flow graph UI | P0 | 📋 Planned |
| k6 load runner with hard limits | P0 | 📋 Planned |
| Live latency / error charts | P0 | 📋 Planned |
| Experiment persistence (PostgreSQL) | P0 | 📋 Planned |
| Basic report | P0 | 📋 Planned |
| Demo app (API, Redis, Postgres, worker, frontend) | P0 | 📋 Planned |
| Preflight safety checks | P1 | 📋 Planned |
| Redis stop/restore fault | P1 | 📋 Planned |
| Phase comparison + recovery time | P1 | 📋 Planned |
| Evidence-based impact highlighting | P1 | 📋 Planned |
| Load ramp + breaking point | P1 | 📋 Planned |
| Kill switch + watchdog restore | P1 | 📋 Planned |
| CPU / memory via docker stats | P2 | 📋 Planned |
| DB connection / pool diagnostics | P2 | 📋 Planned |
| Bottleneck classification | P2 | 📋 Planned |
| Latency injection (Toxiproxy) | P2 | 📋 Planned |
| Run-vs-run comparison | P2 | 📋 Planned |
| Gemini explanations | P2 | 📋 Planned |
| CLI core (`parse`, `impact`, `load run`, `fault run`, `abort`, `report`, exit codes) | P1 | 📋 Planned |
| CLI extras (`run -f`, `list`, `compare`, `open`, Rich live view) | P2 | 📋 Planned |
| CI example workflow | P2 | 📋 Planned |
| Prometheus + cAdvisor | P2 | 📋 Planned |
| Kubernetes / Helm input | — | ⛔ Out of scope |
| PackageTrap / dependency scanning | — | ⛔ Out of scope |

Update this table honestly as work lands. Nothing is ✅ until its tests in §17 pass.

---

## 19. 24-Hour Build Plan

Assumes a team of 4: **BE** (backend), **LT** (load/fault/infra), **FE** (frontend), **DA** (demo app + tests + pitch). Adjust for team size.

| Hours | BE | LT | FE | DA |
|---|---|---|---|---|
| 0–1 | Repo scaffold, FastAPI skeleton, DB, schemas | Docker Compose for control plane | Vite + Tailwind + routing + theme | Demo API endpoints |
| 1–4 | Compose parser + graph builder + tests T1–T5 | k6 template + runner subprocess + JSON stream parsing | Graph page with React Flow + inspector | Demo compose, Redis/PG wiring, seed data |
| 4–8 | Experiment controller (capacity only), WS stream, persistence | Metrics bucketing, percentiles, T6–T7, hard limits T10 | Traffic Twin page + live charts | Integration test T17, health endpoints |
| **8** | **🎯 Checkpoint: P0 end-to-end (upload → graph → load test → live charts → saved report)** | | | |
| 8–12 | Preflight + allowlists T11–T12 | Docker fault injector, watchdog, restore T19–T21 | Experiment live view (graph + charts + phases) | Basic report page |
| 12–15 | Phase stats, recovery calc T9, evidence rules | Load ramp + breach detection T8, auto-stop T22 | Status badges, evidence feed, breach markers | Tune demo for reproducible Redis + pool breach |
| **15** | **🎯 Checkpoint: P1 complete; full demo runnable** | | | |
| 15–18 | Report builder + recommendations T14–T15; **CLI core** (`parse`, `load run`, `fault run`, `abort`, `report`) T24–T27 | docker stats CPU/mem, pg pool metrics (P2) | Report page, history list | Record fallback run (labelled RECORDED) |
| 18–20 | CLI live view + `run -f`; Gemini (P2, only if all above green) | Bottleneck rules (P2) | Polish, accessibility pass | Rehearse demo ×3 |
| 20–22 | **Feature freeze.** Bug fixes only | | | |
| 22–24 | README, status table, test results, slides | | | Final rehearsal, backup video |

**Cut order if behind:** Gemini → Toxiproxy → history compare → bottleneck classification → docker stats → load ramp refinement. **Never cut:** real measurements, preflight, kill switch, restore.

---

## 20. Setup and Deployment

### 20.1 Prerequisites

- Docker Desktop / Docker Engine 24+ with Compose v2
- Node.js 20+ (frontend dev)
- Python 3.11+ (backend dev)
- k6 is bundled in the backend Docker image (no host install needed)

### 20.2 Environment (`.env.example`)

```dotenv
# Control plane
BLASTRADIUS_BIND=127.0.0.1
BLASTRADIUS_ALLOW_REMOTE=0
DATABASE_URL=postgresql+asyncpg://blastradius:blastradius@br-db:5432/blastradius

# Safety
LOAD_TARGET_ALLOWLIST=localhost,127.0.0.1,demo-api,demo-frontend
FAULT_ALLOWLIST=demo-redis,demo-api
MAX_RPS=500
MAX_VUS=200
MAX_DURATION_S=300
MAX_TOTAL_REQUESTS=100000

# Optional diagnostics (demo DB only)
DEMO_DB_URL=postgres://demo:demo@demo-postgres:5432/demo

# Optional AI (leave empty to disable)
GEMINI_API_KEY=
```

### 20.3 Run everything

```bash
cp .env.example .env
```

```bash
docker compose -f demo-app/compose.yaml up -d --build
```

```bash
docker compose up -d --build
```

Open `http://127.0.0.1:5173`.

> The backend container mounts `/var/run/docker.sock` to control **only** allowlisted, labelled containers. This is powerful access. Run BlastRadius only on a local or dedicated test machine.

### 20.4 Local development

```bash
cd backend && pip install -e ".[dev]" && uvicorn app.main:app --reload --host 127.0.0.1
```

```bash
cd frontend && npm install && npm run dev
```

### Use the CLI

```bash
pip install -e backend
```

```bash
blastradius parse demo-app/compose.yaml
```

```bash
blastradius fault run --service demo-redis --kind stop --target http://demo-api:3000 --endpoint /api/cart/1 --rps 20
```

```bash
blastradius run -f experiments/capacity-ramp.yaml
```

### 20.5 Reset after a bad run

```bash
make reset
```

---

## 21. Three-Minute Demo Script

**Pre-demo checklist (5 min before):** demo app healthy · terminal open next to the browser with `blastradius status` green · BlastRadius graph pre-loaded · one recorded fallback run available (labelled **RECORDED**) · browser zoom 110% · notifications off.

| Time | Act | On screen | Say |
|---|---|---|---|
| 0:00–0:20 | **Hook** | Overview page | "Every team ships hoping Redis never dies and traffic never doubles. BlastRadius lets you find out first, with measurements, not guesses." |
| 0:20–0:45 | **Architecture** | Upload `compose.yaml` → graph appears. Click Redis → predicted blast radius. | "Solid edges are declared. Dashed are inferred from env vars. Note the worker has no `depends_on`, but we found it via `REDIS_HOST`. All of this is a **prediction**. Let's verify it." |
| 0:45–1:05 | **Act 1: Baseline** | Start fault experiment (1×, 20 RPS). Live charts. | "Real synthetic traffic, about 20 requests per second. p95 is [read value], errors are [read value]." |
| 1:05–1:35 | **Act 2: Break Redis** | Phase flips to FAULT. Redis node → FAULT INJECTED. API node → IMPACT OBSERVED as evidence arrives. | "We just stopped Redis. The cart endpoint's error rate went from [x] to [y]. The API node lit up only *after* we measured it. Products endpoint? Unaffected. The graph said it *might* be." |
| 1:35–1:55 | **Act 3: Recover** | Phase → RECOVERY. Recovery timer. Node → RECOVERED · [n]s. | "Redis is back. Recovery took [n] seconds, measured as the first 5 stable seconds within SLO." |
| 1:55–2:30 | **Act 4: Capacity** | Start the ramp **from the terminal**: `blastradius run -f experiments/capacity-ramp.yaml`. The dashboard picks up the same run live and shows the breach marker. | "Same engine, two interfaces: this is how it runs in CI. Now no faults, just load. 1×, 2×, 5× pass. At [m]× p95 crosses 300 ms. And BlastRadius shows the DB pool had [k] waiting clients, so this is connection-pool exhaustion, not CPU." *(If diagnostics are unavailable, say "bottleneck unknown", as the UI does.)* |
| 2:30–2:50 | **Act 5: Report** | Report page: phase table, evidence, recommendations. | "One report: resilience and capacity, every claim linked to evidence, limitations listed. Top fix: treat Redis as a soft dependency." |
| 2:50–3:00 | **Close** | Tagline | "BlastRadius. Break it before production does." |

**Fallback:** if live run fails, open the recorded run. The badge reads **RECORDED**, and you say so out loud.

**Tip:** read real numbers off the screen. Never pre-script values.

---

## 22. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Docker socket permissions on demo laptop (Windows/WSL) | Med | High | Test on demo machine by hour 8; document WSL2 backend requirement |
| k6 generator saturates the laptop, not the app | Med | High | Track `dropped_iterations`; cap at 500 RPS; label `load_generator_limited` |
| Redis restore slow / ioredis doesn't reconnect | Low | Med | Tune `retryStrategy`; it's still a valid finding if measured |
| Noisy laptop measurements | High | Med | Short baselines, show sample counts, use 3σ noise rule |
| Live demo failure on stage | Med | High | Recorded fallback (clearly labelled), backup video |
| Scope creep into P2 | High | High | Hard checkpoints at hours 8 and 15; feature freeze at 20 |
| Gemini hallucinating numbers | Med | Med | Grounding post-check; optional feature |

---

## 23. Glossary

| Term | Meaning |
|---|---|
| **Blast radius** | The set of services affected when one service fails |
| **Declared / inferred / verified** | Confidence levels for a dependency (config / heuristic / measured) |
| **SLO** | Service Level Objective, e.g. p95 < 300 ms |
| **p95** | 95% of requests completed faster than this latency |
| **Open-model load** | Requests arrive at a fixed rate regardless of response time; avoids coordinated omission |
| **Coordinated omission** | Measurement bias where slow responses reduce the request rate, hiding latency |
| **Breaking point** | The lowest *tested* load level at which an SLO is breached |
| **Recovery time** | Time from restoring a fault until SLOs hold for N consecutive seconds |
| **Preflight** | Mandatory safety checks before any experiment starts |
| **Confounded run** | An experiment that changes more than one variable; no single-cause attribution allowed |
