# Control Tower frontend

Next.js (App Router) + TypeScript UI for the Agent Control Tower: a memory graph of the agents,
the issues the detectors raise, Claude's suggested fixes, replay and trace (blast radius).

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Stack

- **shadcn/ui** (Radix primitives + Tailwind CSS v4) for buttons, sheet, toggle group, slider, command menu
- **React Flow** (`@xyflow/react`) for the memory graph, with custom nodes and floating curved edges
- **Motion** for the trace animation and panel transitions
- **cmdk** for ⌘K search, **Sonner** for toasts, **Lucide** for icons, **next-themes** for light/dark

## Layout

- `src/lib/types.ts` mirrors the backend schemas from the integration guide (events, issues, fixes, design spec)
- `src/lib/sample-data.ts` holds run-42; swap it for `GET /v1/runs`, `/v1/runs/{id}/events` and `/v1/issues`
- `src/lib/graph.ts` folds events into graph links and computes the trace (same rules as `GET /v1/blast-radius`)
- `src/components/tower/` holds the app: store, sidebar, top bar, graph, reading panel and views
- `src/components/ui/` holds the shadcn components
