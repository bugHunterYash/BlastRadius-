# Agent runtimes: running and observing real Claude Code and Codex agents

The Control Tower doesn't only read traces. It **runs** coding agents, captures everything they visibly do, stores it in PostgreSQL, and connects it to what they read and wrote in the shared notebook. That's what lets the detectors, the Summarizer and the Fixer work on real behaviour.

```
POST /v1/agents/{agent}/invoke
        │
  execution.submit ── router.resolve(agent, active design) ── AgentRoute (stored on the invocation)
        │                                   │
        │                     registry[route.runtime]: AgentRuntime
        │                       ├─ ClaudeRuntime  ── claude-agent-sdk ── Claude Code CLI (subprocess)
        │                       ├─ CodexRuntime   ── `codex app-server` (stdio JSON-RPC subprocess)
        │                       └─ ReplayRuntime  ── recorded transcript (opt-in, labelled "replay")
        ▼
  every RuntimeEvent: redact → INSERT agent_execution_events (next sequence) → SSE "agent.<type>"
        ▼
  invocation finalized (status, final response, provider ids, tokens) + agent_sessions upserted
        ▼
  run_end → detectors (memory events) → Ollama digest (+ execution rows, execution_summary)
          → Fixer (+ linked invocations' prompts, answers, actions) → human approval → rerun verifies
```

The core (`execution.py`, `router.py`) only talks to `AgentRuntime` (`runtime/base.py`):
`start`, `invoke(request, emit)`, `resume(session_id, request, emit)`, `cancel(invocation_id)`, `health()`.

## Configuring which provider runs which agent

The routing lives in the design (`design/design.json`, or `PUT /v1/design`), under `runtimes`. Agent objects in the form `{"id": ..., "provider": ...}` are also accepted and are normalized into this map.

```json
"runtimes": {
  "researcher": {"provider": "codex",  "model": null, "workspace_id": "demo-workspace",
                 "permissions": {"read": true, "write": false, "execute": true}},
  "writer":     {"provider": "claude", "model": null, "workspace_id": "demo-workspace",
                 "permissions": {"read": true, "write": false, "execute": false}}
}
```

| Field | Meaning |
|---|---|
| `provider` | `claude` → `claude_agent_sdk`, `codex` → `codex_app_server`, `replay` → `replay` |
| `model` | `null` = `CLAUDE_AGENT_MODEL` / `CODEX_MODEL` from env, else the provider's default. Never hard-coded. |
| `workspace_id` | a directory under `AGENT_WORKSPACE_ROOT` (default `tower/workspaces/`). Symlink-resolved; `..` and links leaving the root are refused. |
| `permissions` | `read` → Read/Glob/Grep, `write` → Edit/Write, `execute` → Bash (Claude). For Codex, `write: false` → `read-only` sandbox; `write: true` → `CODEX_SANDBOX` (`workspace-write`). `danger-full-access` is never used. |
| `allowed_tools`, `permission_mode`, `max_turns`, `timeout_s`, `enabled` | optional overrides. `bypassPermissions` is refused. |

**System prompt:** the agent's application-owned config (`demo-agents/config/<agent>.yaml`: prompt, handoff rule, routing). That is the text the Fixer edits. So an approved fix changes the next invocation's instructions, and you can see it in `system_prompt` on the invocation.

## What is captured

| Provider | Source | Stored as |
|---|---|---|
| both | our request | `prompt.received` (exact prompt + system prompt), `invocation.created` (full routing decision) |
| Claude | `SystemMessage(init)` | `session.started` (session id, model, tools) |
| Claude | `StreamEvent` text deltas | `message.delta` |
| Claude | `AssistantMessage` TextBlock / ToolUseBlock | `message.completed`, `tool.started` (+ `command.started` for Bash) |
| Claude | `UserMessage` ToolResultBlock | `tool.completed` (+ `command.completed`, `file.changed` for Edit/Write) |
| Claude | `ResultMessage` | `usage.updated`, final response, cost, `execution.error` on errors |
| Codex | `thread/start`/`resume` result | `session.started` (thread id, model, sandbox, approval policy) |
| Codex | `item/agentMessage/delta` | `message.delta` |
| Codex | `item/started`/`item/completed`: commandExecution, fileChange, mcpToolCall, webSearch, plan, agentMessage | `command.*`, `file.changed` (path, kind, diff), `tool.*`, `plan.updated`, `message.completed` |
| Codex | `item/commandExecution/outputDelta` | `command.output` |
| Codex | `thread/tokenUsage/updated`, `error`, `turn/completed` | `usage.updated`, `execution.error`, final status |
| Codex | server requests `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` | `approval.requested` (why = Codex's stated reason), `approval.decided` |

**Not stored:**
- Claude `ThinkingBlock` and Codex `reasoning` items. Hidden reasoning is never captured.

**Size and secrets:**
- Every payload is redacted (API keys, bearer tokens, `password=`-style values, and the server's own secret env values).
- Payload strings are capped at 8 000 characters; prompts and final answers at 20 000.

**Approval policy for Codex:**
- File changes inside the workspace are accepted when the agent may write.
- Command escalations (anything outside the sandbox) are declined.

### `why`: only public explanations, never invented

| Where | `why` comes from |
|---|---|
| invocation, `prompt.received` | the `why` field of the invoke request (the orchestrator's reason) |
| Claude tool call | the tool's own `description` input (Bash has one), else the visible text the assistant wrote just before the call (`why_source` says which) |
| Codex command / tool | the visible agent message written just before it (`why_source: preceding_agent_message`) |
| Codex approval request | the `reason` Codex sends with the request |
| memory events | `tower.remember(..., why=...)` / `recall` / `handoff` in the SDK |
| anything else | `null` |

A `tool.started` doesn't mean the action worked. Results are separate events (`tool.completed`, `command.completed` with `exit_code` and `status`).

## Tables (`migrations/002_agent_runtime.sql`; rollback: `002_agent_runtime.down.sql`)

- **`agent_sessions`:**
  - a Claude session id or Codex thread id, per run, agent and provider;
  - used for `session_id` resume.
- **`agent_invocations`:**
  - prompt, system prompt and final response (stored apart from the events);
  - status, provider thread and turn ids, tokens, usage, the routing decision, `idempotency_key`, and `last_sequence`.
- **`agent_execution_events`:** `(invocation_id, sequence)` is unique and gap-free. The invocation row is locked per append, and `(invocation_id, dedupe_key)` is unique, so provider replays don't duplicate events.
- **`events.invocation_id`:** a memory event made during an invocation points to it. The SDK sets it from `tower.as_agent(name, invocation_id)`, or from `TOWER_INVOCATION_ID`, which both runtimes export to the agent process.

## API

All of it is in Swagger at `/docs`. `invoke` and `cancel` need `Authorization: Bearer $TOWER_API_TOKEN`, or the ingest token when that's unset.

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/agents/{agent_id}/invoke` | `{run_id, prompt, why?, workspace_id?, session_id?, idempotency_key?}` → **202** `{invocation_id, provider, runtime, model, status}`; 200 for a repeated idempotency key |
| GET | `/v1/agents` | every agent's resolved route (or why it can't be routed) |
| GET | `/v1/agents/providers/health` | real checks: Claude CLI starts, Codex app-server handshake + `account/read`, Ollama model installed, Postgres, Meko `list_tools` |
| GET | `/v1/invocations/{id}` | prompt, system prompt, final response, ids, tokens, routing, event counts, memory events made during it |
| GET | `/v1/invocations/{id}/events?after_sequence=&types=&limit=` | chronological; use `after_sequence` to catch up after an SSE reconnect |
| POST | `/v1/invocations/{id}/cancel` | Codex `turn/interrupt` / Claude `interrupt()`, then process cleanup; 409 if not running |
| GET | `/v1/runs/{run_id}/invocations` | invocations of a run + `execution_summary` |
| GET | `/v1/stream?run_id=&agent_id=&invocation_id=` | one SSE stream, optional filters. Agent events are named `agent.<type>`, with SSE id `<invocation_id>:<sequence>` |

SSE payload of an execution event:

```json
{"run_id": "live-codex-2", "agent_id": "researcher", "invocation_id": "e3467164-…", "provider": "codex",
 "sequence": 14, "timestamp": "2026-10-31T16:01:48.559410+00:00", "event_type": "agent.command.started",
 "why": "I'll check the local pricing file.",
 "payload": {"command": "powershell.exe -Command \"Get-Content -LiteralPath 'pricing.md'\"", "item_id": "exec-7fbd…",
             "why_source": "preceding_agent_message"}}
```

`GET /v1/invocations/{id}` from a real Codex run (trimmed):

```json
{"invocation_id": "e3467164-94e4-4fb6-979d-abed24a85980", "run_id": "live-codex-2", "agent_id": "researcher",
 "provider": "codex", "runtime": "codex_app_server", "model": "gpt-5.6-terra", "status": "completed",
 "why": "Live smoke test: researcher finds the launch price",
 "provider_thread_id": "01a192b1-f6eb-7500-a62c-17c5d4fb16ca", "provider_turn_id": "01a192b1-f7dd-7a10-909f-2b6a4fa2c32a",
 "user_prompt": "Read pricing.md in this folder and reply with only the current price of the Aqua bottle. Do not modify any files.",
 "final_response": "Rs. 549", "input_tokens": 30435, "output_tokens": 203,
 "event_counts": {"invocation.created": 1, "invocation.started": 1, "prompt.received": 1, "session.started": 1,
                  "message.delta": 12, "message.completed": 2, "command.started": 1, "command.completed": 1,
                  "usage.updated": 2, "invocation.completed": 1},
 "memory_events": [], "running": false}
```

`GET /v1/issues/{id}` now also returns `invocations`: the runs of the agents involved, each linked by `invocation_id`.

The run digest has a counted `execution_summary`:

```json
{"total_invocations": 2, "completed": 1, "failed": 1, "cancelled": 0, "running": 0, "by_provider": {"codex": 1, "claude": 1}}
```

## Run it

```bash
docker start tower-pg            # or: docker run -d --name tower-pg -e POSTGRES_PASSWORD=tower -e POSTGRES_DB=tower -p 5433:5432 postgres:16-alpine
```

```bash
.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 8000
```

```bash
.venv/Scripts/python -m tower.cli design push design/design.json
```

```bash
curl -s http://localhost:8000/v1/agents/providers/health
```

Codex (researcher):

```bash
curl -s -X POST http://localhost:8000/v1/agents/researcher/invoke -H "Authorization: Bearer $TOWER_API_TOKEN" -H "Content-Type: application/json" -d '{"run_id":"run-101","prompt":"Read pricing.md and reply with only the current price. Do not modify any files.","why":"Find the launch price"}'
```

Claude (writer):

```bash
curl -s -X POST http://localhost:8000/v1/agents/writer/invoke -H "Authorization: Bearer $TOWER_API_TOKEN" -H "Content-Type: application/json" -d '{"run_id":"run-101","prompt":"Read auth.py and list its security problems in three bullets. Do not modify files.","why":"Security review before deploy"}'
```

Then:

```bash
curl -s http://localhost:8000/v1/invocations/<invocation_id>
```

```bash
curl -s "http://localhost:8000/v1/invocations/<invocation_id>/events?after_sequence=0"
```

```bash
curl -N "http://localhost:8000/v1/stream?run_id=run-101"
```

Smoke script and full demo:

```bash
python scripts/live_smoke.py researcher --api http://localhost:8000
```

```bash
python demo-agents/runtime_demo.py --mode live --approve --api http://localhost:8000
```

```bash
python demo-agents/runtime_demo.py --mode replay --approve --api http://localhost:8000
```

Replay mode needs `REPLAY_RUNTIME_ENABLED=true` on the server.

## Importing Claude Code sessions that already ran on this machine

Claude Code (desktop app, CLI, IDE) saves every session as a local transcript. The tower can import them into the same inspector as live runs. It's read-only, uses the SDK's `list_sessions` / `get_session_messages`, and needs no login.

```bash
curl -s "http://localhost:8000/v1/claude-sessions?limit=20" -H "Authorization: Bearer $TOWER_API_TOKEN"
```

```bash
curl -s -X POST http://localhost:8000/v1/claude-sessions/<session_id>/import -H "Authorization: Bearer $TOWER_API_TOKEN"
```

The import becomes an invocation with:
- `runtime: "claude_code_import"`, run `claude-session-<id8>`;
- `routing.launched_by_tower: false`;
- events using the same rules as live capture (`why` from tool descriptions or the preceding text; thinking dropped; secrets redacted).

Importing the same session again returns the earlier import. claude.ai web chats aren't stored on disk, so they can't be imported. Token totals only count uncached input tokens.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Codex: `The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account` | `~/.codex/config.toml` picks a model your plan can't use. Set `CODEX_MODEL` to one listed by the app-server's `model/list` (e.g. `gpt-5.6-terra`). |
| Claude: `failed`, response `Not logged in · Please run /login` | The Claude Code CLI has no login. Either set `ANTHROPIC_API_KEY` in `backend/.env`, or log the CLI in once (run the bundled CLI, `…/site-packages/claude_agent_sdk/_bundled/claude.exe`, and use `/login`). Health shows `auth_mode`; the login itself is only proven by a run. |
| Wrong amounts like `₹1549` from Codex on Windows | Windows PowerShell 5.1 reads UTF-8 files without a BOM as ANSI, so `₹5` became `ƒ,1`. The captured `command.completed` output shows it. Use ASCII (`Rs.`) or save files with a BOM. |
| Invocation stuck `running` | It's cancelled at `timeout_s` (default 300s). `POST /cancel` interrupts at once. |
| Health says Codex unavailable | `codex` must be on PATH (or set `CODEX_BIN`), and `codex login status` must say you're logged in. |
| Digest says "no issues" while issues exist | It can't any more: when detectors found issues, a headline denying them is replaced by a counted one. |
| Scenario suite slow | Each run waits for the Ollama digest (~50s on CPU). Run the suite with `OLLAMA_MODEL=` on the server for speed. |

## Verified on this machine (2026-10-31)

- **Codex CLI 0.146.0:**
  - the protocol schema was generated with `codex app-server generate-json-schema --out schemas/codex`;
  - real runs completed on `gpt-5.6-terra`, capturing the prompt, deltas, the PowerShell command with its exit code and output, and token usage.
- **claude-agent-sdk 0.2.176 with bundled Claude Code CLI 2.1.316:**
  - a real run starts a session (session id stored, model `claude-opus-5-5`);
  - it then fails with "Not logged in". The adapter's full message parsing is covered by tests that use the SDK's own message classes.
- **Meko:**
  - no access yet. The local notebook table stands in, and health reports it as such.
  - `list_meko_tools()` is wired up for the day access arrives.
