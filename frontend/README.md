# Control Tower frontend

Next.js (App Router) + TypeScript UI for the Agent Control Tower: a memory graph of the agents,
the issues the detectors raise, Claude's suggested fixes, replay and trace (blast radius), signing
in to the agent runtimes, and asking an agent to do something from the chat.

## Run

Start the backend first (`tower/`, see its README), then:

```bash
npm install
cp .env.example .env.local      # TOWER_API_URL / TOWER_API_TOKEN
npm run dev
```

Then open http://localhost:3000 (or set `PORT`). With the backend down, the UI falls back to the bundled
sample run and says so in the sidebar.

## How it talks to the backend

- **`src/app/api/tower/[...path]/route.ts`** is a server-side proxy to the backend's `/v1` API.
  - It adds the API token on the server, so the browser never holds it.
  - It streams responses through, which is what keeps `/v1/stream` (SSE) live.
- **`src/lib/api.ts`** is the typed client. `loadSnapshot()` fetches the run on screen: runs, memory events, issues, design, digests and agent routes.
- **`src/lib/data.ts`** maps backend shapes to the UI's types and exposes them as live bindings (`EVENTS`, `RUNS`, `DESIGN`, `LAYOUT`…).
  - Components keep importing them; the store swaps in a new run and re-renders.
  - The layout of agents and facts is computed for whatever the design contains.
- **`tower-store.tsx`:**
  - loads the newest run that has memory events;
  - follows `/v1/stream` and reloads on changes;
  - sends approve/dismiss decisions to `/v1/fixes/{id}/approve|reject`.

## Agents: sign in and ask

- **Connect agents** (sidebar, or ⌘K) shows whether Claude Code and Codex are signed in, using `GET /v1/agents/auth`.
  - **Claude:** **Sign in** starts the Claude Code CLI's own login, which opens Anthropic's page (Continue with Google, or email). If the page shows a code, paste it into the box in the dialog.
  - **Codex:** **Sign in** opens ChatGPT's sign-in for the Codex CLI.
  - The tower never sees a password or token.
- **Ask an agent:** in the chat composer, switch the target from the datapack to an agent, e.g. "Ask Researcher · Codex".
  - The message goes to `POST /v1/agents/{id}/invoke`, which runs it on the agent's real runtime.
  - The answer streams back into the chat from `agent.*` events on `/v1/stream`.
  - If that runtime isn't signed in, the composer offers to connect it first.

## Stack

- **shadcn/ui** (Radix primitives + Tailwind CSS v4) for buttons, sheet, toggle group, slider, command menu, dialog
- **React Flow** (`@xyflow/react`) for the memory graph, with custom nodes and floating curved edges
- **Motion** for the trace animation and panel transitions
- **cmdk** for ⌘K search, **Sonner** for toasts, **Lucide** for icons, **next-themes** for light/dark

## Layout

- `src/lib/types.ts` mirrors the backend schemas (events, issues, fixes, design spec)
- `src/lib/sample-data.ts` holds the offline sample run (run-42)
- `src/lib/graph.ts` folds events into graph links and computes the trace (same rules as `GET /v1/blast-radius`)
- `src/components/tower/` holds the app: store, sidebar, top bar, graph, reading panel, views, agent access
- `src/components/ui/` holds the shadcn components
