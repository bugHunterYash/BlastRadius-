# BlastRadius — Feature Implementation Guide

> How each feature in `plan.md` gets built. Not code — implementation logic, data flow, and the decisions a developer needs at their desk.
>
> Stack recap: Python 3.11+ / FastAPI / Pydantic v2 core · k6 subprocess · Docker SDK · PostgreSQL · SSE · React + Vite + React Flow + Recharts · Typer/Rich CLI.

---

## How to read this

Each feature follows the same shape:

| Field | Meaning |
|---|---|
| **Input** | What it consumes |
| **Logic** | The algorithm / decision flow, step by step |
| **Output** | What it produces (schema or artifact) |
| **Edge cases** | The ways it fails and what it does then |
| **Where it lives** | Package/module path |

---

## Module A — Architecture Intelligence

### A1. Compose Parser

**Input:** YAML file (≤ 256 KB) or pasted string.

**Logic:**
1. Size check → reject with exact byte count if over cap.
2. `yaml.safe_load` only. Wrap in try/except; on `yaml.YAMLError`, extract `problem_mark` → format as `Line L, column C: <problem>`.
3. Guard against alias bombs: count aliases during a custom loader pass; reject if > 100.
4. Require top-level `services` map; if missing → specific error ("No 'services' section found…").
5. For each service, extract supported keys: `image`, `build`, `ports`, `expose`, `depends_on` (short list OR long map with `condition`), `links`, `environment` (list OR map form — normalize both to dict), `env_file` (names only, never read), `healthcheck`, `networks`, `deploy.resources.limits`, `labels`, `restart`.
6. Record any key we don't understand in `unanalysed_keys` — preserve, never silently drop.
7. Validate: every `depends_on` / `links` target must exist in `services` (else error naming both services); detect cycles with DFS (else error showing the cycle path); validate port specs with a regex (`[ip:][host:]container[/proto]`) — invalid → error with the service name and bad spec.

**Output:** `ComposeModel` (Pydantic) — normalized services, raw warnings list.

**Edge cases:** empty file; YAML that parses to a list not a map; duplicate service names (Compose spec forbids — error); `depends_on: []` (valid, empty); env values that look like URLs (fine, passed through); Windows line endings.

**Where:** `core/parser/compose.py`

---

### A2. Service Classification

**Input:** One `ServiceNode` from the parser.

**Logic:** Ordered heuristic rules; first match wins; every match is marked `kind_inferred=True`:
1. **database** — image regex `postgres|mysql|mariadb|mongo` OR container port in {5432, 3306, 27017}
2. **cache** — image regex `redis|valkey|memcached` OR port in {6379, 11211}
3. **queue** — image regex `rabbitmq|kafka|nats` OR port in {5672, 9092, 4222}
4. **frontend** — image regex `nginx|caddy` OR build context path contains `frontend|web|client` OR published port in {80, 443, 3000, 5173}
5. **api** — exposes an HTTP port (80/443/3000/8000/8080) AND depends on at least one database/cache/queue
6. **worker** — no published ports AND depends on queue/cache/database
7. **unknown** — fallback; shown as "unknown kind" in UI

**Output:** `ServiceKind` enum + `kind_inferred: bool`. User override in the inspector writes `kind_inferred=False`.

**Where:** `core/graph/classify.py`

---

### A3. Edge Detection (declared + inferred)

**Input:** Full `ComposeModel`.

**Logic:**
1. **Declared edges** — for each `depends_on` and `links` entry: edge (dependent → dependency), `sources=["declared"]`, reason `"depends_on: <svc>"` or `"links: <svc>"`.
2. **Inferred env edges** — for each service, scan every env var *value* for a hostname that matches another service name. Patterns: full URL authority (`redis://demo-redis:6379`), `HOST=demo-postgres`, `ADDR=demo-redis:6379`. Extract candidate host, look it up in the service set. If found and no declared edge already exists: edge with `sources=["inferred:env"]`, reason `"env <KEY> = <value>"` (value redacted if it contains a password pattern `://[^:]+:[^@]+@`).
3. **Inferred network edges (low confidence, toggle in UI)** — two services share a user-defined (non-default) network AND no declared/env evidence exists between them. Marked `inferred:network`, only rendered when the user enables the toggle.
4. Merge: if multiple sources support the same edge, union the `sources` and `reasons` lists.

**Output:** `list[DependencyEdge]`.

**Edge cases:** env value references an external hostname (e.g. `api.stripe.com`) — not a service, skipped; two services reference each other via env (cycle in inferred graph — allowed, BFS handles cycles with visited set); password in URL — redacted in reasons.

**Where:** `core/graph/edges.py`

---

### A4. Predicted Blast Radius

**Input:** Graph + selected service `S`.

**Logic:** Reverse BFS from `S` over the union of declared + inferred edges (network edges only if toggle was on at parse time). For each reachable node `T`, record the path and the reason(s) on the first edge that discovered it. Mark the whole result "PREDICTED — not verified".

**Output:** `PredictedImpact { service, impacted: [{service, via_path, reasons}] }` — rendered in the inspector and as a preview overlay on the graph.

**Where:** `core/graph/impact.py`

---

### A5. Gap Analysis (what's missing)

**Input:** `ComposeModel` (same parse pass — no second read).

**Logic:** Deterministic rule table; each rule emits zero or one `GapFinding`:

| Rule | Condition | Severity |
|---|---|---|
| missing-healthcheck | service kind ∈ {api, database, cache} AND no `healthcheck` | medium |
| missing-limits | no `deploy.resources.limits.cpu` or `.memory` | low |
| missing-restart | no `restart` key (or `restart: "no"`) | low |
| single-database | exactly one service classified database, no replica hint | medium |
| exposed-port | any port published on `0.0.0.0` or without IP bind | medium |
| no-cache-heuristic | an api service exists, no cache/queue service in graph | low |

Each finding stores: `rule_id`, `severity`, `service`, `detail` (human sentence), `compose_path` (e.g. `services.demo-api.healthcheck`) so the UI can deep-link.

**Output:** `list[GapFinding]`, merged into the stored graph JSONB and rendered as red dashed badges.

**Where:** `core/graph/gaps.py`

---

## Module B — Failure Simulator

### B1. Preflight Checks

**Input:** `ExperimentCreate` + live Docker state.

**Logic:** Run all 9 checks; any failure → state `PREFLIGHT_FAILED`, return every failed check (not just the first):

1. **env-label** — every container on the target network has label `blastradius.env=test`. Query: `docker ps --filter network=br-target`.
2. **fault-allowlist** — fault target container has label `blastradius.fault-allowed=true` AND is in `FAULT_ALLOWLIST` env.
3. **production-guard** — inspect fault + load-target containers' env for `ENV|NODE_ENV|APP_ENV ∈ {prod, production}` OR label `blastradius.env=production` → abort, no override flag exists.
4. **network-isolation** — target network name == `br-target`; load-target container doesn't publish ports on `0.0.0.0` beyond the allowed set.
5. **load-allowlist** — parse `target_base_url.host` against `LOAD_TARGET_ALLOWLIST`; resolve DNS and confirm IP ∈ loopback/RFC1918/Docker subnet.
6. **limits** — requested RPS/VUs/duration/timeout ≤ server caps (re-validate even though Pydantic already did — defense in depth).
7. **target-health** — `GET {base}/health` 3× with 1s spacing; all must return 200.
8. **no-concurrency** — try to acquire the global asyncio lock; fail if held.
9. **restore-path** — Docker socket reachable; fault target is not `--rm`; container exists and has restart capability.

**Output:** `PreflightResult { passed, checks: [PreflightCheck{id, label, passed, detail}] }`.

**Where:** `core/safety/preflight.py`

---

### B2. Fault Injection (stop/restore)

**Input:** Fault command from the controller (`STOP service` / `RESTORE service`) + experiment id.

**Logic:**
1. Resolve container by name (must match allowlist + labels again — never trust the caller blindly).
2. On STOP: `container.stop(timeout=5)`; immediately label the container `blastradius.faulted-by=<experiment_id>` and `blastradius.faulted-at=<iso>` via `container.update(labels=...)`. Start the watchdog task with `max_fault_duration_s` (hard cap 120s).
3. On RESTORE: `container.start()`; remove the fault labels; cancel the watchdog.
4. All Docker calls wrapped: on any exception, mark experiment `FAILED`, attempt restore in `finally`, log structured error.

**Output:** success/failure + timestamp recorded as a `phase_marker`.

**Where:** `core/faults/injector.py`

---

### B3. Guaranteed Restore (watchdog + startup sweep)

**Logic (three independent mechanisms):**
1. **Per-fault watchdog** — asyncio task sleeps `max_fault_duration_s`; on wake, if the container is still labeled `faulted-by=<id>`, force `container.start()` and log a warning.
2. **Controller `finally`** — the experiment task's `finally` block restores every container it faulted, regardless of how the task ended.
3. **Startup sweep** — on backend boot (and `br reset`), list all containers with label `blastradius.faulted-by` and start/unpause each, then clear the labels. This covers hard crashes.

**Where:** `core/faults/watchdog.py` + `app/startup.py`

---

### B4. Experiment Controller (state machine)

**Input:** Validated `ExperimentCreate` + start signal.

**Logic:**
```
states: PENDING → (preflight) → RUNNING → COMPLETED | ABORTED | AUTO_STOPPED | FAILED

async def run(exp):
    async with global_lock:
        await preflight(exp)            # fail → PREFLIGHT_FAILED, return
        mark RUNNING; start SSE broadcaster
        k6 = await spawn_load(exp.load) # subprocess
        collector = start_collector(k6.stdout)

        if exp.type == FAULT:
            phase(BASELINE, exp.fault.baseline_s)
            await inject_fault(exp.fault); phase_mark(FAULT)
            phase(FAULT, exp.fault.fault_s)
            await restore_fault();       phase_mark(RECOVERY)
            await await_recovery(exp)    # until stable or timeout
        elif exp.type == CAPACITY:
            for m in exp.load.multipliers:
                phase(LOAD_STEP, m, exp.load.step_duration_s)
                # k6 script already encodes the ramp; controller just tags buckets
        # fault_under_load (P2): both, confounded=True

        await stop_k6(graceful, then kill)
        report = build_report(exp, buckets, evidence)
        persist(buckets, markers, evidence, report)
        mark COMPLETED
    finally:
        restore_all_faulted(exp)         # B3 mechanism 2
```

Abort path (SSE/REST/`br abort`/Ctrl+C): cancel the run task; `finally` restores faults; state `ABORTED`. Safety auto-stop: collector detects threshold breach for N consecutive seconds → abort with state `AUTO_STOPPED` + reason.

**Output:** final state + all persisted rows.

**Where:** `core/controller/experiment.py`

---

## Module C — Traffic Twin Load Testing

### C1. k6 Script Generation

**Input:** `LoadConfig` + endpoint list.

**Logic:** Render a Jinja2 template (`template.js.j2`) — users never supply JavaScript. Template shape:

```js
export const options = {
  scenarios: { load: {
    executor: 'ramping-arrival-rate',
    startRate: <baseline_rps>, timeUnit: '1s',
    stages: [ /* per multiplier: { target: baseline*m, duration: '<step>s' } with <ramp>s pre-ramp */ ],
    maxVUs: <max_vus>, gracefulStop: '10s',
  }},
  thresholds: { http_req_failed: ['rate<0.5'], http_req_p95: ['p(95)<5000'] },  // safety net
};
// scenario: for each endpoint, http.get(base + path) weighted; per-request JSON via --out json=-
```

All numbers JSON-escaped into the template. Also write the rendered script to a temp file and return its path + contents (UI shows it read-only).

**Output:** script path + rendered source.

**Where:** `core/load/template.js.j2` + `core/load/runner.py`

---

### C2. k6 Subprocess Management

**Logic:**
1. Spawn `k6 run --out json=- <script>` via `asyncio.create_subprocess_exec`, stderr piped to logs, cwd = temp dir.
2. Hard caps also enforced here: kill the process if wall time exceeds `duration + 10s` or request count (tracked by collector) exceeds 100k.
3. Parse stdout as a stream of JSON lines. Each line is either a sample (`type: "Point"`) or a summary. Only Points with metric `http_req_duration` / `http_req_failed` / `dropped_iterations` are consumed.
4. Graceful stop: `proc.terminate()`, wait 5s, `proc.kill()`. Confirm process is gone (integration test T18).

**Output:** async iterator of raw sample dicts `{t, endpoint, status, duration_ms, error}`.

**Edge cases:** k6 binary missing → experiment `FAILED` with "k6 not installed"; script syntax error (shouldn't happen, template is tested) → capture stderr, `FAILED`; stdout closes early → flush collector, mark partial.

**Where:** `core/load/runner.py`

---

### C3. Metrics Collector (1s buckets + raw samples)

**Input:** Raw sample stream from C2 + health probes + (optional) docker stats.

**Logic:**
1. Two sinks in parallel:
   - **Raw sink** — append each sample to an in-memory buffer; on experiment end, write gzipped JSONL (`raw_samples.jsonl.gz`) to disk; store path on the experiment row. (≤ 100k lines, a few MB.)
   - **Bucket sink** — a dict keyed by `floor(t)` second. Per second, accumulate: requests, successes, failures, timeouts, sum/max for percentiles, per-endpoint counters. Percentiles within a bucket: exact sort of that second's durations (≤ few hundred values — trivial).
2. Health prober: every 2s, `GET /health` on the target; store status per service if the app exposes per-service health, else overall.
3. Docker stats sampler (P2-lite): every 2s, `docker stats --no-stream` via SDK; CPU%/mem% per container, `status: unavailable` if socket denied.
4. Every bucket tagged with the controller's current `phase` and `load_multiplier` (read from a shared `PhaseClock` the controller updates).
5. Push each completed bucket to the SSE broadcaster.

**Output:** `MetricBucket` objects; raw gzip file; live SSE `bucket` messages.

**Honesty rule:** any metric source that's absent produces `OptionalMetric { value: null, status: "unavailable", reason }` — never 0.

**Where:** `core/metrics/collector.py`

---

## Analysis

### D1. Phase Stats

**Input:** All buckets for one experiment.

**Logic:** Group buckets by phase (or by `load_multiplier` for capacity runs). For each group: sum requests/failures, weighted mean RPS, exact p50/p95/p99 recomputed from the raw gzip file for that time range (not averaged from bucket percentiles — averaging percentiles is wrong). Delta vs baseline computed for each metric.

**Output:** `PhaseStats` list.

**Where:** `core/analysis/phases.py`

---

### D2. SLO Breach & Breaking Point (capacity)

**Input:** Phase stats (per load step) + `SLO`.

**Logic:**
```
for each step (steady-state window, excluding ramp seconds):
    breached = p95 > slo.p95_ms
            or error_rate > slo.max_error_rate
            or achieved_rps < slo.min_rps_ratio * target_rps
first_breach = min multiplier among breached steps
highest_pass = max multiplier among non-breached steps
breaking_point_range = (highest_pass, first_breach)  # exclusive bounds
if no step breached: "no breach up to <max tested>"
```

**Output:** breach marker (elapsed, multiplier, failed SLOs, measured values) pushed over SSE as `breach`; stored on the report.

**Where:** `core/analysis/slo.py`

---

### D3. Recovery Measurement (fault)

**Input:** Buckets after the restore timestamp + `SLO` + `recovery_stable_s` (default 5) + `recovery_timeout_s` (default 60).

**Logic:**
```
recovered_at = first t where for N consecutive 1s buckets:
    error_rate ≤ slo.max_error_rate and p95 ≤ slo.p95_ms
recovery_time = recovered_at - restore_time
if no such t within timeout: recovered=False, report "not recovered within <timeout>s"
```

Never assume recovery. The report wording is fixed: either the measured seconds or "not recovered".

**Where:** `core/analysis/recovery.py`

---

### D4. Impact Attribution (evidence)

**Input:** Buckets + baseline phase stats + endpoint→service map (from demo-app config or user-declared).

**Logic:** For each non-faulted service, evaluate during the FAULT window:
1. `request_errors` — any endpoint attributed to the service has error_rate rise ≥ 5 percentage points vs baseline AND fault value > baseline_mean + 3σ.
2. `latency_regression` — p95 rises ≥ 50% vs baseline AND ≥ 50 ms absolute.
3. `health_check` — service health flipped to unhealthy during the window.
4. `log_signature` (P2) — configured error regex appears in container logs during fault, absent in baseline.

Each hit creates an `Evidence { service, kind, metric, baseline_value, observed_value, window, sample_count, detail }`. A predicted-path service with zero evidence stays "predicted, not observed" — and if it had no metrics at all, the report says so explicitly.

**Output:** evidence rows + verified-impact set (services with ≥1 evidence row).

**Where:** `core/analysis/evidence.py`

---

### D5. Bottleneck Classification (P2)

**Input:** Buckets at first breach + baseline + docker-stats/pg-pool series.

**Logic:** Ordered rules, first match wins; default `unknown`:
1. `load_generator_limited` — `dropped_iterations > 0` or generator CPU saturated → results invalid (checked first, overrides everything).
2. `db_connection_exhaustion` — active connections ≥ 90% of pool max AND waiting clients > 0.
3. `cpu_bound` — target container CPU ≥ 90% of its limit.
4. `memory_pressure` — mem ≥ 90% of limit, or OOM/restart observed.
5. `downstream_latency` — dependency latency rose while CPU < 70%.
6. `unknown` — always the fallback; report lists which signals were available vs missing.

**Where:** `core/analysis/bottleneck.py`

---

## Module D — Fix Prompt & Re-test

### E1. Fix Prompt Generator

**Input:** Final `Report` (recommendations, evidence, breaking point, bottleneck, config).

**Logic:** Fill a deterministic Markdown template (no LLM):

```
You are working in this repository: {repo_hint or "the uploaded compose stack"}

GOAL: Make this app survive {target} without changing behavior or API responses.

MEASURED TODAY:
- {failure_mode sentence from evidence}
- Breaking point: {range or "no breach up to X"}
- Recovery after {fault}: {time or "not recovered"}

FIX THESE, IN ORDER:
{for each recommendation, P1 first}
{n}. [{priority}] {title}
   Why: {rationale}
   Evidence: {evidence_refs → metric, baseline → observed}
{end}

CONSTRAINTS
- Keep routes, request/response shapes, existing tests passing.
- Config via env vars with defaults in .env.example.
- Don't remove features.

ACCEPTANCE CRITERIA
- Re-run experiment "{name}" with the same config: all SLOs hold, {specific target}.
- {if bottleneck known}: {bottleneck-specific criterion}
```

**Output:** Markdown string stored in the report + rendered in a monospace panel with a Copy button; `br report --fix-prompt` prints it.

**Why deterministic:** every number and recommendation already passed grounding rules; an LLM here could only introduce errors. AI (P2) can *expand* each item with prose, but the artifact stands alone without it.

**Where:** `core/report/fix_prompt.py`

---

### E2. Before/After Re-test

**Input:** An original experiment id + a signal that the user has redeployed their (fixed) stack.

**Logic:**
1. Clone the original `ExperimentCreate` verbatim (same load, same SLOs, same fault config). Set `compared_to = <original_id>`.
2. Run through the normal controller (full preflight — the stack changed, labels might be wrong).
3. On completion, build a comparison object: side-by-side phase stats, recovery time, breaking point, evidence count, (score if enabled). Fairness check: compare the two configs; if CPU/memory limits or load config differ, stamp a warning "configs differ — not a fair comparison".
4. Persist the pair; render in the Before/After page and `br compare a b`.

**Output:** `Comparison { before: Report, after: Report, deltas, fairness_warning? }`.

**Where:** `core/analysis/compare.py`

---

### E3. Resilience Score (P2)

**Input:** Final report.

**Logic (deterministic, clamped 0–100):**
```
start = 100
- 15 if any SLO breach in fault run
- 10 if recovery_time > 10s or not recovered
- 12 per critical verified impact (cap 24)
- 8 per high gap finding (cap 16)
- 10 if breaking point < 2× baseline
- 8 if bottleneck == unknown (honesty penalty: we couldn't tell you why)
+ 10 if before/after re-test passed all SLOs
clamp(0, 100)
```
Weights tuned after real runs so a "broken" stack lands ~15–30 and a "fixed" one ~85–92 (never 100 — that looks fake). Always displayed alongside the raw evidence, never alone.

**Where:** `core/report/score.py`

---

## API + Realtime

### F1. REST Endpoints

Thin FastAPI routers over the core services. Every request body is a Pydantic schema from `core/schemas/`. Validation errors return 422 with field paths. Key routes:

| Route | Delegates to |
|---|---|
| `POST /api/architecture/parse` | A1 → A3 → A5 → persist graph |
| `GET /api/architecture/{id}/impact/{svc}` | A4 |
| `POST /api/experiments` | validate + B1 preflight → `PENDING` or 422 |
| `POST /api/experiments/{id}/start` | B4 controller task |
| `POST /api/experiments/{id}/abort` | B4 abort path |
| `GET /api/experiments/{id}/samples` | read buckets from DB |
| `GET /api/reports/{id}` | stored report |
| `GET /api/reports/{id}/fix-prompt` | E1 on the fly from stored report |
| `POST /api/reports/compare?a=&b=` | E2 |
| `POST /api/system/reset` | B3 startup sweep, manually triggered |

**Where:** `backend/app/api/`

---

### F2. SSE Stream (`GET /api/experiments/{id}/stream`)

**Logic:** `StreamingResponse` with `media_type=text/event-stream`. Subscribe to the controller's in-process `broadcast` queue. Emit one SSE event per message:

```
event: bucket
data: {"t": "...", "phase": "fault", "p95_ms": 412, ...}

event: evidence
data: {...}

event: state
data: {"state": "completed"}
```

Heartbeat comment every 15s to keep proxies alive. On client disconnect, unsubscribe. Fallback: the dashboard polls `GET /samples?from=` every 2s if the stream errors.

**Where:** `backend/app/api/stream.py`

---

## CLI

### G1. Command Behaviors

All commands construct the same Pydantic configs as the API. Two modes:
- **Standalone (default):** import `core` directly, run the controller in-process, persist to SQLite/Postgres per config. No HTTP.
- **Remote (`--remote URL`):** thin HTTP client to a running backend; SSE consumed for live output.

| Command | Implementation |
|---|---|
| `br run config.yaml` | Load config → validate → run controller → stream buckets to Rich live table/sparklines → on finish, print summary + exit code (0 pass / 1 breach / 2 error). Ctrl+C → abort path. |
| `br report <id>` | Load report → render Rich table or `--md` file; `--fix-prompt` prints E1 output. |
| `br parse <file>` | A1+A3+A5 → print tree with edge sources + gap findings; `--json` full graph. |
| `br abort <id>` / Ctrl+C | POST abort (remote) or cancel task (standalone). |
| `br reset` | B3 startup sweep; restore everything; clear lock. |
| `br compare <a> <b>` | E2 comparison as a Rich diff table. |
| `br demo up/down` | shell out to `docker compose -f demo-app/compose.yaml up/down`. |

**Where:** `cli/commands/*.py`, shared `cli/output.py` for Rich renderers.

---

## Frontend

### H1. Graph Workspace (React Flow)

**Logic:** Dagre layout on mount. Custom `ServiceNode` component reads a status prop (`healthy | under_test | fault_injected | impact_observed | recovered | unverified`) → renders color + icon + text label + border style (never color alone) + `aria-label`. Edge styling by `sources`: solid (declared), dashed (inferred), amber+thick (verified). Click node → inspector fetches impact (A4) + evidence links. "Run experiment" button pre-fills the experiment form with `target_service` set; disabled unless `fault_allowed`.

**Where:** `frontend/src/components/graph/`

---

### H2. Live Charts (Recharts)

**Logic:** Three stacked `ComposedChart`s sharing an x-axis (elapsed seconds), fed by the SSE hook (fallback polling). `ReferenceArea` bands per phase; `ReferenceLine` for SLO thresholds; `ReferenceDot` at breach. Data appended to a `useRef` array, batched into state every 500ms to avoid re-render thrash. p99 drawn only when `status != low_sample`.

**Where:** `frontend/src/components/charts/`

---

### H3. Fix Prompt Panel

**Logic:** Fetch `/reports/{id}/fix-prompt` (or from stored report). Render in a `<pre>` with a Copy button (`navigator.clipboard.writeText`). No editing — it's generated, not a form. Below it, a "Re-test" button that clones the experiment config and starts a new run linked via `compared_to`.

**Where:** `frontend/src/components/report/FixPromptPanel.tsx`

---

## Persistence

### I1. Write Paths

| When | What | How |
|---|---|---|
| Parse | graph + gaps | single INSERT into `architecture_graphs` (JSONB) |
| Experiment create | config + preflight | INSERT `experiments` (config immutable after start) |
| During run | phase markers, buckets | batched INSERT every 5s (not per-bucket — reduce write amplification) |
| Evidence detected | evidence rows | immediate INSERT (low volume) |
| Experiment end | report, raw-sample path | UPDATE `experiments`, INSERT `reports`, write gzip file |
| Before/after | `compared_to` link | UPDATE second experiment's row |

Buckets are the live-chart source of truth; the raw gzip is the report's percentile source of truth. If they disagree, the report wins (recompute from raw).

---

## Cross-cutting: Honesty & Safety Invariants

These are enforced in code review, not just documented:

1. **Never zero-fill a missing metric.** Every optional series is `OptionalMetric` with a reason.
2. **Never call a prediction "verified."** The `verified` edge source is only written by D4, only from stored evidence.
3. **Never emit a causal sentence from a confounded run.** `Report.confounded=True` short-circuits the recommendation generator's causal templates.
4. **Every restore path is triple-redundant** (watchdog, `finally`, startup sweep). Deleting any one fails review.
5. **Hard caps checked in three places** (Pydantic validator, runner, k6 options). A bypass in one must be caught by another.
6. **Fault injection re-checks labels at call time**, not at preflight time — the world may have changed between check and act.
7. **The fix prompt contains only numbers from the report.** Template fill, no string interpolation of anything user-supplied that isn't already in a validated field.
