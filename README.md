# BlastRadius

> **Break it before production does.**

An AI reliability agent for Docker Compose apps. It maps your services, breaks them on purpose in a safe local sandbox, measures what really fails under real synthetic traffic, and hands you an evidence-backed fix, then proves the fix with a same-config re-run.

Built for **CBS 9.0** with a **₹0 budget**: open-source tools, plain PostgreSQL, and the Gemini API free tier.

---

## The loop

```
MAP            BREAK              MEASURE              FIX                PROVE
compose   →   fault + load   →   statistical     →   AI fix prompt  →   re-run same test,
graph         in a sandbox       evidence report                         before / after
```

- **Predicted vs verified:** the graph shows what *could* break (from config) separately from what *did* break (from measurements).
- **Honest numbers:** missing metrics are labelled `unavailable`, never zero. Non-live data is always badged.
- **Safe by design:** only allowlisted, labelled test containers; hard caps on load; kill switch everywhere; guaranteed restore; control plane bound to `127.0.0.1`.
- **Agent, not garnish:** Gemini plans experiments with typed tools, runs nothing without your confirmation, and can't state a number it didn't read from a tool.

## Status

This repo is **in active development** for the hackathon. Honest snapshot:

| Area | Status |
|---|---|
| `core/` engine: parser, dependency graph, gap analysis, preflight, k6 script generation, metrics, analysis, report, fix prompt, before/after compare | Built, with ~325 unit checks (results to be recorded) |
| `backend/` FastAPI REST + SSE | Built |
| Fault path fixes (fault not wired, fault-run crash, restore) | Fixed on engine branch `feat/yash-YA-08`, not pushed or merged here yet |
| Live experiments save 0 metric buckets, so the real-load (Pro) report can't be built | Open |
| **Agent Control Tower** (`tower/` backend, `frontend/` UI): Claude, Codex and Antigravity runtimes, live sync, Meko memory, detectors, session report, BlastX tab | Built and run with real agents; backend tests 103 passed, 1 skipped |
| Agents writing their findings to Meko | Done for New project runs (each agent reads the last one's findings) |
| Cloud deploy (`deploy/`: Docker Compose, Caddy, setup script) | Written, not tried on a server yet |
| Landing page and waitlist (`landing/`) | Built |
| Gemini agent, `br` CLI | Not started |

Details: [docs/HANDOFF.md](docs/HANDOFF.md) (current) and [docs/PROGRESS_REPORT.md](docs/PROGRESS_REPORT.md) (older engine audit).

## Documentation

| Doc | What it is |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | **Start here when taking over.** Agent Control Tower + BlastX: decisions, architecture, how to run, what's left |
| [docs/CONTROL_TOWER_SCRIPT.md](docs/CONTROL_TOWER_SCRIPT.md) | Whole-product pitch and explainer in Hinglish: problem, solution, Meko, YugabyteDB, tech stack, demo |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Putting the tower and BlastX on one cloud server (Vultr / DigitalOcean), with HTTPS and a login |
| [docs/PRD.md](docs/PRD.md) | **Source of truth.** Problem, features, agent spec, API contract, data model, team split, timeline, tests, demo script |
| [docs/TASKS.md](docs/TASKS.md) | **Per-member task checklist** with hours, done-checks, and handoffs |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product: use cases, `npm install -g blastx` install flow, commands, business model and pricing |
| [docs/PITCH.md](docs/PITCH.md) | 5-minute judges pitch (Hinglish), demo flow, Q&A prep |
| [docs/mockups/](docs/mockups/) | Prototype images: simple dashboard, simple CLI, pricing page, plus detailed expert views |
| [docs/PHASE_PLAN.md](docs/PHASE_PLAN.md) | Build phases, bug list, premium CLI design spec |
| [docs/PROGRESS_REPORT.md](docs/PROGRESS_REPORT.md) | Audit of what's done, % complete, tests to run after each phase |
| [docs/plan.md](docs/plan.md) · [docs/implementation.md](docs/implementation.md) | Original design notes |
| [docs/BLASTRADIUS_SPEC.md](docs/BLASTRADIUS_SPEC.md) | Original long-form spec (reference) |

## Repository layout

```
core/        shared engine (parser, graph, safety, controller, load, metrics, analysis, report, store)
backend/     FastAPI app (REST + SSE), imports core/
tests/       unit tests
tower/       Agent Control Tower: FastAPI backend, agent runtimes, live sync, Meko client, SDK, demo agents
frontend/    Control Tower UI (Next.js 15, React 19, Tailwind, shadcn, React Flow)
landing/     landing page and waitlist (Vite)
deploy/      one-server cloud deploy (Docker Compose, Caddy, setup.sh)
docs/        handoff, PRD, pitch, deploy guide, design notes
```

The engine's demo app and its `docker-compose.yml` live on the engine branch (`feat/yash-YA-08`). Planned: `cli/` (`br`). How to run the tower: [docs/HANDOFF.md](docs/HANDOFF.md) §5.

## Running the tests (current state)

```bash
python -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt pytest pytest-asyncio
```

Most test files are scripts today (each has a `main()`), so run them directly until the pytest wrappers land in Phase 0:

```bash
for f in tests/test_*.py; do .venv/bin/python "$f" || echo "FAILED: $f"; done
```

## Team

| Member | Area |
|---|---|
| Yash | Backend platform, `br` CLI, Docker, frontend–backend integration |
| Ayush | Backend engine, PostgreSQL store, Gemini agent |
| Sanchi | Frontend: shell, design system, architecture, report, before/after |
| Harshit | Frontend: live experiment, capacity, agent chat |

Task breakdown: [docs/TASKS.md](docs/TASKS.md).

## Safety

BlastRadius is for systems you own, in isolated test environments. It refuses production markers, non-allowlisted hosts, and unlabelled containers, and it never replays real user traffic.
