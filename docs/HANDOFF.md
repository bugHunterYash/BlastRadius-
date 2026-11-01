# Handoff: Agent Control Tower + BlastX

**For the next AI assistant (or teammate) picking this up.** Read this first. It says what the project is, what
is built and verified, the decisions already made (don't re-open them without asking Yash), how to run
everything, and what's left. Last updated 1 Nov 2026. `feature/control-tower-live` (`2903e9a`) is merged
into `main` on `public` ([PR #3](https://github.com/bugHunterYash/BlastRadius-/pull/3), merge commit `35ee1c6`).

---

## 1. What this is, in one paragraph

**Agent Control Tower** is the main product: a control room for teams of AI coding agents (Claude Code,
Codex, Antigravity) that work on the same project and share memory through **Meko** (a shared agent
memory by Yugabyte, reached over MCP). The tower records every agent's steps, detects coordination
problems (stale reads, conflicts, skipped handoffs, permission leaks), proposes fixes, shows it all live,
and writes a session report. **BlastRadius / BlastX** is a smaller tool inside it: it maps a Docker
Compose architecture and shows what breaks when a service (e.g. Redis) goes down, with suggested fixes,
and later runs a real chaos test under load as the Pro tier.

> Yash's framing, important: *the notebook / LLM-agents control tower is the core; BlastX is a minor
> tool inside it.* Don't centre answers or UI on BlastRadius.

## 2. People, repos, branches

| What | Where |
|---|---|
| Owner | Yash (GitHub `bugHunterYash`). Talks in Hinglish; wants things fully working with real data, not demos. |
| This repo (nested git repo) | `C:\Users\F(x)ash\Documents\cbs\.claude\worktrees\blastradius-simulator-e244a7\blastradius` |
| Working branch | `feature/control-tower-live`, already merged into `main` (PR #3). Start new work on a fresh branch from `public/main`. |
| Remote to push to | **`public`** = `github.com/bugHunterYash/BlastRadius-`. **Not `origin`** (`sanchigoyal73/blastradius1`, unrelated history). |
| Branches on `public` | `main` (`35ee1c6`); `feature/control-tower-live` and `feature/control-tower-frontend` (both merged); `feature/google-auth` (open [PR #2](https://github.com/bugHunterYash/BlastRadius-/pull/2), see §7); `feature/team-memory-and-ui-fixes` (open [PR #4](https://github.com/bugHunterYash/BlastRadius-/pull/4): Meko team memory, UI fixes, deploy, real data only, `/dashboard`, Google sign-in). |
| Engine repo (BlastRadius engine on :8000) | `C:\Users\F(x)ash\Documents\cbs final`, branch `feat/yash-YA-08`, commit `dc49ffc` (fault path fixes). Its remote is the same GitHub repo, but **this branch is not pushed yet**. Teammates' uncommitted `Makefile` and `tests/integration/test_load_parity.py` there are **not ours: don't touch**. |
| Team | Sanchi and Harshit own frontend pages in the engine repo; Ayush owns `core/controller`, `core/faults`, `core/analysis`, `core/store` and the agent. |

## 3. Decisions already made (don't re-litigate)

- **Database: plain PostgreSQL 16** in Docker (`tower-pg`, port 5433), not YugabyteDB. Yugabyte's YSQL
  speaks the Postgres protocol, so moving later is a connection-string change, but Yash chose plain PG.
- **Summarizer: Ollama, smallest model** that works on an i5-10th gen + Iris Xe, 8 GB RAM:
  `qwen2.5:0.5b` (`qwen2.5:1.5b` also pulled). Small models hallucinate, so `agents/summarizer.py` has
  deterministic guards (fills skipped agents, drops invented ones). Every number in reports is counted,
  never generated.
- **Agent runtimes:** Claude via `claude-agent-sdk` (CLI signed in with Google / claude.ai, no API key);
  Codex via `codex app-server` JSON-RPC (ChatGPT sign-in; model `gpt-5.6-terra` because the default isn't
  supported on that plan); Antigravity via `agy -p --output-format stream-json` (Google sign-in in the app).
- **Antigravity never gets shell commands** headless: its terminal sandbox isn't available on this
  Windows host, and the only alternative is `--dangerously-skip-permissions`. It reads with its file tools.
- **Security posture:** every `/v1` route except `/v1/health` and event ingest needs the token. The
  Next.js proxy (`frontend/src/app/api/tower/[...path]/route.ts`) holds the token server-side, answers
  only on localhost hosts, and refuses cross-site writes. Backend binds `127.0.0.1`.
- **Privacy:** secrets are redacted at capture (`runtime/redact.py`); status endpoints never return
  emails; synced personal chats never appear as runs or in project reports.
- **Project folders:** agents only run under `tower/workspaces/` or in a project folder opened from the
  UI, and a folder can only be opened if a synced Claude/Codex/Antigravity session already works in it.
  Home folder and drive roots are refused. Project tasks are read-only unless "Allow edits" is on.
- **Commit and push only when Yash says so.** Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Writing style for UI copy and docs:** plain words, short sentences, no jargon, no em-dash-heavy text.

## 4. Architecture

```
 Claude app / Claude Code ─┐                       ┌─ Meko (mcp.mekodata.ai) shared memory
 Codex app ────────────────┼─ live sync (5 s) ─┐   │
 Antigravity app ──────────┘                   ▼   ▼
                                   FastAPI backend :8010 ── Postgres 16 (tower-pg :5433)
 Tower agents (invoke) ──────────► runtimes: claude_sdk | codex_app_server | antigravity_cli
   researcher, writer, reviewer,   pipeline: detectors → issues → fixer → Ollama summary
   publisher, analyst              SSE /v1/stream
                                          ▲
 Next.js UI :3100 ── /api/tower proxy ────┘        BlastRadius engine :8000 (Docker) ── demo stack
   chat, memory graph, BlastX tab, report,         (api :3000, redis, postgres, worker, frontend)
   workspaces, new project
```

### Backend (`tower/backend/app`)
| File | Job |
|---|---|
| `main.py` | App, lifespan (DB init, migrations, live sync, crash recovery), router mounting with token |
| `config.py` | All settings (pydantic-settings, `tower/backend/.env`) |
| `db.py`, `execution_db.py` | asyncpg pool, runs/events/invocations/sessions |
| `execution.py` | Queues and runs agent invocations; `recover_interrupted()` on startup |
| `runtime/` | `claude_sdk.py`, `codex_app_server.py`, `antigravity_cli.py`, `router.py` (design → route), `workspace.py`, `auth.py`, `redact.py` |
| `live_sync.py` | Claude sessions (SDK), Codex threads (app-server; CLI threads read from rollout files), Antigravity chats (its `conversation_summaries.db`, read-only) |
| `projects.py` | Project workspaces (folders opened to agents) |
| `briefs.py` | New project runs and the report's data (`/v1/runs/{id}/report`) |
| `meko_client.py` | Meko over MCP: one persisted conversation (`app_state` table), datapack, `memory_add` / `memory_search` |
| `routers/blastx.py` | Proxies the engine: architecture from a compose file, impact of a service failing |
| `pipeline.py`, `detectors/`, `agents/summarizer.py`, `agents/fixer.py` | Analysis after a run |
| `migrations/001–005` | Applied automatically at startup (`*.down.sql` skipped) |

### Frontend (`frontend/src`, Next.js 15, React 19, Tailwind v4, shadcn, React Flow, recharts)
`components/tower/`: `shared-chat.tsx` (chat + multi-@tag composer), `memory-graph.tsx`,
`graph-panel.tsx` (Memory / Architecture·BlastX tabs, 60/40 split), `blastx-graph.tsx`,
`session-report.tsx` (+ `lib/analytics.ts`), `new-project.tsx`, `project-workspace.tsx`,
`live-sessions.tsx`, `agent-access.tsx`, `sidebar.tsx`, `tower-store.tsx` (state).
`lib/api.ts` (all API calls), `lib/data.ts` (live data bindings).

**Routes:** `/` is the landing page (`components/landing/`, merged from `feat/landing-redesign-and-polish`; its
"TRY IT" buttons open `/dashboard`, "Log in" opens `/login`; `/tower` redirects to `/dashboard`); the app is at
**`/dashboard`**; `/login` is the sign-in page. A landing page's "Log in" / "Try it out" button should link to
`/dashboard` (it sends people to `/login` first when sign-in is on, and back after).

**Only real data:** the UI never shows the bundled sample (`lib/sample-data.ts` stays for types and project
templates). Until a run loads it shows "Connecting", "The backend isn't reachable" or "No runs yet".
Scripted runs (`demo-`, `scn-`, `replay-`) stay in the database for tests but are hidden from the UI.

**Google sign-in** (Auth.js v5, `next-auth@5.0.0-beta.32`, taken from Ayush's PR #2 and finished):
`src/auth.ts`, `src/middleware.ts` (guards `/dashboard` and `/api/tower/*`), `src/app/login/page.tsx`,
`components/tower/user-menu.tsx`. It is **off until** `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set in
`frontend/.env.local` (git-ignored; `AUTH_SECRET` and `AUTH_ALLOWED_EMAILS` are already there). Only emails in
`AUTH_ALLOWED_EMAILS` can sign in, since the dashboard drives agents on this machine. Google Cloud Console
redirect URI: `http://localhost:3100/api/auth/callback/google` (plus `https://<domain>/api/auth/callback/google`
in the cloud). Checked with placeholder keys: `/dashboard` → `/login`, the API → 401. The real Google round
trip needs the real client id and secret.

### Design (`tower/design/design.json`)
Agents: researcher (Codex), writer (Claude), reviewer (Claude), publisher (Codex), analyst (Antigravity).
Push changes (from `tower/`, with `TOWER_API_TOKEN` or `TOWER_INGEST_TOKEN` in env):
`.venv/Scripts/python.exe -m tower.cli --api http://127.0.0.1:8010 design push design/design.json`.

## 5. How to run (Windows)

```powershell
# Postgres (once)
docker start tower-pg            # postgres:16 on localhost:5433, db "tower", password "tower"
# Ollama
ollama serve ; ollama pull qwen2.5:0.5b
# Backend :8010  (from the worktree root)
blastradius/tower/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir blastradius/tower/backend --host 127.0.0.1 --port 8010
# UI :3100
$env:TOWER_API_URL="http://127.0.0.1:8010"; $env:PORT="3100"; npm --prefix blastradius/frontend run dev   # then open http://localhost:3100/dashboard
# BlastRadius engine :8000 and the demo stack run in Docker (blastradius-backend-1, blastradius-demo-*)
```
The same commands are in the worktree's `.claude/launch.json` (`tower-api`, `tower-ui`).

**Tests:** `cd blastradius/tower && .venv/Scripts/python.exe -m pytest backend/tests -q` → **103 passed, 1 skipped**.
Frontend: `npx tsc --noEmit -p .` and `npx eslint src/components/tower/` in `frontend/` (both clean).

### `tower/backend/.env` (git-ignored; see `.env.example`)
`DATABASE_URL`, `OLLAMA_MODEL=qwen2.5:0.5b`, `CODEX_MODEL=gpt-5.6-terra`,
`LIVE_SYNC_CLAUDE_DIR=C:\Users\F(x)ash\Documents\cbs` (only this project's Claude sessions),
`MEKO_MCP_URL=https://mcp.mekodata.ai/mcp`, `MEKO_API_KEY=…` (a teammate's key; never print or commit it),
`MEKO_TEXT_ARG=text`. Token: `TOWER_API_TOKEN` (falls back to the dev ingest token).

### Cloud deploy (`deploy/`, not committed yet)
One Ubuntu server, all in Docker: `deploy/docker-compose.yml` runs tower-db (Postgres 16), Ollama,
tower-api, tower-ui (Next.js `output: "standalone"`) and Caddy (HTTPS + one basic-auth login). Only
80/443 are public. `deploy/setup.sh` installs Docker, writes `deploy/.env` with random secrets, starts the
engine and demo stack from the engine branch, then the tower. Full guide: [DEPLOY.md](DEPLOY.md).
In the cloud, live sync and the Antigravity agent are off (`LIVE_SYNC_ENABLED=false`,
`ANTIGRAVITY_RUNTIME_ENABLED=false`); the proxy accepts the domain through `TOWER_ALLOWED_HOSTS`.
Not tried on a real server yet.

## 6. What's built and verified with real runs

- **Folders must be allowed:** live sync imports a chat only when its folder is on the allowed list
  (`app/folders.py`, migration 008, `LIVE_SYNC_ALLOWED_FOLDERS_ONLY`, on by default). A new install allows none,
  so nothing personal shows until someone signs in and picks folders (sidebar "Folders", or the "Allow a folder"
  prompt). Folders the apps work in are offered by path only. Removing a folder removes its chats from the tower.
  Allowed on 1 Nov: `Documents\cbs` and `Documents\cbs final`.
- **Sign-in is required on a server:** `AUTH_REQUIRED` defaults to true in production (and is forced in
  `deploy/docker-compose.yml`); without Google keys the dashboard and API stay locked. In dev without keys it
  stays open on localhost. Checked both: locked mode sends `/dashboard` to `/login`, the API answers 401.
- **Only this account's chats:** Antigravity keeps every account's chats in one index; only the signed-in
  account's belong to an Antigravity project, so sync reads just those (`ANTIGRAVITY_PROJECT_CHATS_ONLY`). Any
  synced chat can be hidden for good with "Hide from tower" (table `hidden_chats`, migration 007); Yash hid the
  old account's Codex chats (hi, VAPT Dev Paaji, piduuu) and the AccessOrbit Claude chat on 1 Nov.
- **Live sync:** this Claude session, real Codex threads and 20 Antigravity chats show up live; only new
  steps appended; finished steps only; running chats aren't re-read.
- **Multi-agent chat:** `@writer @researcher …` sends one message to each, each in its own conversation.
- **Antigravity agent (Analyst):** answers real tasks; reviewed `live_sync.py` and found two real bugs (fixed).
- **New project:** brief + folder + each agent's part → run starts; verified with "Aqua bottle launch
  readiness" (Codex, Claude, Antigravity all completed).
- **Project workspace:** every agent working in a folder, shared feed, Assign work panel (read-only default).
- **Session report:** real brief, tasks, answers, tokens (Claude cached input counted), steps, timing,
  task log, method & privacy section, Download PDF (browser print; **PDF click not yet tested by a human**).
- **BlastX:** demo stack parsed by the real engine; failing `demo-redis` cuts it off the graph; API and
  worker break directly, frontend via API, Postgres keeps running; rule-based fixes; Pro card.
- **Meko:** connected; 42 tools; writes and searches work; notes and approvals go to Meko.
- **Security:** checked with curl: 401 without token, 403 for foreign Host and cross-site POST.
- **UI defaults:** the UI opens on the run with the most issues caught, then the most steps (not just the
  newest). BlastX's Stack follows the open project (its workspace folder, or the project run's brief) until
  someone picks another stack; projects without a compose file say so.

## 7. What's left (in priority order)

1. **Agents' facts → Meko: done for New project runs** (`app/team_memory.py`, migration 006). Before each part
   the tower reads the facts that agent may read (design permissions) from Meko by id (`memory_get_by_id`)
   and puts them in its prompt; after it, the answer is written to Meko (`memory_add`) as the agent's fact,
   then a handoff. Every call is a memory event with its version, so the graph, detectors and summary work on
   project runs. "One after another" (`in_order`, on by default in the UI) makes each part wait for the one
   before. Verified with a real Codex → Claude run (writer read `facts v21`, wrote `draft v27`, no issues).
   Chat questions (run `chat-<date>`) and the workspace "Assign work" panel (run `project-<id>`) share it
   too: the first message of a conversation gets the facts that agent may read, and every answer is saved
   (`team_memory.follow`). Verified live: in chat, Writer (Claude) read the Researcher's `facts v23` from Meko.
2. **BlastRadius engine bug:** live experiments save **0 metric buckets** (suspected aggregator/sample
   time mismatch in the engine repo), so the Pro "real load" test can't produce a report yet.
3. **Pro flow:** run a real experiment from the BlastX tab (create → start → report → fix prompt), then the
   upgrade-to-Pro screen.
4. **Antigravity tool steps** in synced chats: its steps are protobuf blobs; only message text syncs today.
5. **Meko cleanup:** testing left a duplicate "Aqua bottle price" memory and a few spare conversations
   in the teammate's Meko account (delete from the Meko console; deletes are permanent).
6. **Make the deploy runnable.** (a) Commit `deploy/`, `docs/DEPLOY.md`, the two `.dockerignore` files
   and the `frontend/next.config.ts` change, and push, so the `curl …/deploy/setup.sh` link in DEPLOY.md
   works. (b) Push the engine branch `feat/yash-YA-08` (or merge it into `main` and run with
   `ENGINE_BRANCH=main`): `setup.sh` clones it from GitHub and fails today. (c) Try it once on a real server.
7. **PR #2 (`feature/google-auth`, a teammate's) is not safe to merge as is.** Its sign-in part is already in PR #4
   (finished: guarded routes, allow-list, no tokens kept in the cookie), so PR #2 can be closed after #4 merges. It moves `core/graph` to
   `core/analysis/graph` but keeps the `core.graph` imports (in the moved `__init__.py` and in
   `backend/app/api/architecture.py`), so the engine's architecture API fails to import. It also
   conflicts with `main` in `backend/app/main.py` (it branched before PR #3), hard-codes a Google client ID
   as a default, and returns the expected client ID in its error message. Raise these on the PR; don't
   push to that branch without asking.

## 8. Gotchas on this machine

- **8 GB RAM.** The Next dev server can grow past 2.5 GB; with Docker + Ollama + three agent CLIs the PC
  ran out of memory ("paging file is too small"). Restart the UI server if it gets heavy; keep
  `AGENT_MAX_CONCURRENCY=2`. `tsc` may need `NODE_OPTIONS=--max-old-space-size=3072`.
- **Path contains `F(x)ash`.** `cmd.exe` breaks on `(x)`: always launch CLIs with an argv list, never through `cmd /c`.
- **PowerShell 5.1 garbles ₹** in UTF-8 files without BOM; the demo uses "Rs.".
- **Browser pane in the desktop app:** when it's in the background, animations don't run, so drawer
  views don't switch. Bring the tab to the front before testing UI transitions.
- **Shell heredocs** with nested quotes break in Git Bash; write patch scripts to files instead.
- Never use bare `git stash` (shared across worktrees).
- **Don't run `npm run build` while the dev UI is running**: both use `frontend/.next`, and the dev page then
  hangs on "Connecting" with a `SyntaxError` in the console. Stop the UI, build, delete `.next`, start the UI.
