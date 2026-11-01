"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { api, type ArchNode, type Architecture, type Impact, type Project } from "@/lib/api"
import { useTower } from "./tower-store"

const KIND_ICON: Record<string, string> = {
  frontend: "web", api: "api", cache: "bolt", database: "database", worker: "settings_suggest", queue: "queue", proxy: "router",
}

type State = "ok" | "down" | "affected" | "idle"
type ServiceData = { node: ArchNode; state: State; hops?: number; dim: boolean }
type ServiceNode = Node<ServiceData, "service">

/** One service card: kind, name, image and what the engine knows about it. */
function ServiceCard({ data }: NodeProps<ServiceNode>) {
  const { node: n, state, hops } = data
  return (
    <div
      className={cn(
        "relative w-[176px] rounded-xl border-[1.5px] bg-card px-3 py-2.5 shadow-sm transition-all duration-500",
        state === "down" && "border-dashed border-flag bg-flag-soft/60 opacity-80 [filter:grayscale(0.4)]",
        state === "affected" && "border-[var(--agent-reviewer)] bg-[color-mix(in_oklab,var(--agent-reviewer)_9%,var(--card))]",
        state === "ok" && "border-primary/50",
      )}
    >
      {/* a service sits above what it depends on, so its arrows leave from the bottom and arrive on top */}
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-muted-foreground/40" />
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-muted-foreground/40" />
      <div className="flex items-center gap-2">
        <span className={cn("grid size-7 place-items-center rounded-lg bg-muted", state === "down" && "bg-flag text-white", state === "affected" && "bg-[var(--agent-reviewer)] text-white")}>
          <Icon name={KIND_ICON[n.kind] ?? "deployed_code"} size={17} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-bold">{n.id}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{n.image ?? n.kind}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-[10.5px] font-bold">
        {state === "down" && <Badge className="bg-flag text-white">✂ DOWN</Badge>}
        {state === "affected" && <Badge className="bg-[var(--agent-reviewer)] text-white">Breaks · {hops === 1 ? "direct" : `${hops} hops`}</Badge>}
        {state === "ok" && <Badge className="bg-primary/12 text-primary">Keeps running</Badge>}
        {n.has_healthcheck && <Badge className="bg-muted text-muted-foreground">health check</Badge>}
        {n.fault_allowed && <Badge className="bg-muted text-muted-foreground">fault-allowed</Badge>}
      </div>
    </div>
  )
}

const Badge = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={cn("rounded-md px-1.5 py-0.5", className)}>{children}</span>
)

const nodeTypes = { service: ServiceCard }

/** Rows by dependency depth: what users hit on top, what everything relies on at the bottom. */
function layout(a: Architecture["graph"]) {
  const deps = new Map(a.nodes.map((n) => [n.id, a.edges.filter((e) => e.source === n.id).map((e) => e.target)]))
  const depth = new Map<string, number>()
  const visit = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const d = Math.max(0, ...(deps.get(id) ?? []).map((t) => visit(t, seen) + 1))
    depth.set(id, d)
    return d
  }
  a.nodes.forEach((n) => visit(n.id))
  const max = Math.max(0, ...depth.values())
  const rows = new Map<number, string[]>()
  for (const n of a.nodes) {
    const row = max - (depth.get(n.id) ?? 0)
    rows.set(row, [...(rows.get(row) ?? []), n.id])
  }
  const pos = new Map<string, { x: number; y: number }>()
  for (const [row, ids] of rows) ids.forEach((id, i) => pos.set(id, { x: (i - (ids.length - 1) / 2) * 220, y: row * 150 }))
  return pos
}

/** Fix ideas from the rules that tie a broken service to the failed one. Rule-based, not a live test. */
function fixesFor(failed: string, impact: Impact["impact"]["impacted"]) {
  const out: { service: string; text: string }[] = []
  for (const i of impact) {
    const direct = i.via.length === 1
    const r = i.reasons.join(" ")
    if (!direct) out.push({ service: i.impacted_service, text: `Breaks only through ${i.via.slice(0, -1).join(" → ")}. Show a degraded state when that service reports ${failed} down, instead of failing the whole page.` })
    else if (/service_healthy/.test(r)) out.push({ service: i.impacted_service, text: `Won’t even start while ${failed} is unhealthy (depends_on: service_healthy). Start without it and degrade: add a fallback path and drop the hard start-up gate.` })
    else if (/env /.test(r)) out.push({ service: i.impacted_service, text: `Talks to ${failed} directly (${(i.reasons.find((x) => x.startsWith("env")) ?? "").replace(/^env /, "")}). Add a short timeout, retries with backoff and a fallback, so it slows down instead of crashing.` })
    else out.push({ service: i.impacted_service, text: `Shares a network with ${failed}. Confirm it really needs it; if not, remove the link so a failure can’t spread.` })
  }
  return out
}

export function BlastXView() {
  return (
    <ReactFlowProvider>
      <BlastX />
    </ReactFlowProvider>
  )
}

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase() === b.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()

/** The project the person is looking at: the open workspace folder, else the run's project. "" = none. */
function useOpenProject(projects: Project[]): string {
  const { state } = useTower()
  const [fromBrief, setFromBrief] = useState<{ runId: string; workspaceId: string }>({ runId: "", workspaceId: "" })
  const runId = state.runId
  useEffect(() => {
    if (!runId.startsWith("proj-")) return
    let live = true
    api.brief(runId).then((b) => live && setFromBrief({ runId, workspaceId: b.workspace_id ?? "" }), () => {})
    return () => void (live = false)
  }, [runId])
  if (state.workspace) return projects.find((p) => samePath(p.path, state.workspace!))?.workspace_id ?? ""
  // a workspace's "Assign work" tasks go to the run project-<workspace id>
  if (runId.startsWith("project-") && projects.some((p) => p.workspace_id === runId.slice(8))) return runId.slice(8)
  return fromBrief.runId === runId ? fromBrief.workspaceId : ""
}

function BlastX() {
  const { fitView } = useReactFlow()
  const [projects, setProjects] = useState<Project[]>([])
  const open = useOpenProject(projects)
  // follows the open project until the person picks a stack themselves
  const [picked, setPicked] = useState<{ for: string; source: string } | null>(null)
  const source = picked && picked.for === open ? picked.source : open   // "" = demo stack, else a project workspace id
  const [arch, setArch] = useState<Architecture | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [impact, setImpact] = useState<Impact | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => void api.projects().then(setProjects, () => {}), [])
  useEffect(() => {
    setArch(null)
    setFailed(null)
    setImpact(null)
    setError(null)
    api.architecture(source || null).then(setArch, (e: Error) =>
      setError(source && /no compose file/.test(e.message)
        ? "This project has no compose.yaml or docker-compose.yml, so there is no architecture to map. Pick Demo stack to try BlastX."
        : e.message))
  }, [source])

  const fail = useCallback(async (service: string | null) => {
    setFailed(service)
    setImpact(null)
    if (!service || !arch) return
    setBusy(true)
    try {
      setImpact(await api.impact(arch.graph.id, service))
    } catch (e) {
      toast.error("BlastX couldn’t work out the impact", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }, [arch])

  const impacted = useMemo(() => new Map((impact?.impact.impacted ?? []).map((i) => [i.impacted_service, i])), [impact])
  const pos = useMemo(() => (arch ? layout(arch.graph) : new Map()), [arch])

  const nodes: ServiceNode[] = useMemo(() => {
    if (!arch) return []
    return arch.graph.nodes.map((n) => {
      const p = pos.get(n.id) ?? { x: 0, y: 0 }
      const state: State = !failed ? "idle" : n.id === failed ? "down" : impacted.has(n.id) ? "affected" : impact ? "ok" : "idle"
      // the failed service drifts out of the graph: cut off from everything it was wired to
      const off = state === "down" ? { x: p.x + 150, y: p.y + 70 } : p
      return { id: n.id, type: "service", position: off, data: { node: n, state, hops: impacted.get(n.id)?.via.length, dim: false }, draggable: true }
    })
  }, [arch, pos, failed, impacted, impact])

  const edges: Edge[] = useMemo(() => {
    if (!arch) return []
    return arch.graph.edges.map((e) => {
      const cut = !!failed && (e.source === failed || e.target === failed)
      const spread = !cut && impacted.has(e.source) && (impacted.has(e.target) || e.target === failed)
      const inferred = !e.sources.includes("declared")
      const color = cut ? "var(--flag)" : spread ? "var(--agent-reviewer)" : "color-mix(in oklab, var(--foreground) 35%, transparent)"
      return {
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        animated: spread,
        label: cut ? "✂ cut" : undefined,
        labelStyle: { fill: "var(--flag)", fontWeight: 800, fontSize: 11 },
        labelBgStyle: { fill: "var(--card)" },
        style: { stroke: color, strokeWidth: cut || spread ? 2.2 : 1.4, strokeDasharray: cut ? "3 6" : inferred ? "5 4" : undefined, opacity: cut ? 0.85 : 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      }
    })
  }, [arch, failed, impacted])

  useEffect(() => {
    if (!nodes.length) return
    const raf = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }))
    return () => cancelAnimationFrame(raf)
  }, [arch, failed, nodes.length, fitView])

  const fixes = failed && impact ? fixesFor(failed, impact.impact.impacted) : []
  const total = arch?.graph.nodes.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-[13px]">
        <label className="flex items-center gap-1.5 font-semibold text-ink-2">
          Stack
          <select value={source} onChange={(e) => setPicked({ for: open, source: e.target.value })} className="h-7 max-w-[180px] rounded-md border bg-background px-1.5 text-[13px]">
            <option value="">Demo stack</option>
            {projects.map((p) => <option key={p.workspace_id} value={p.workspace_id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 font-semibold text-ink-2">
          Fail
          <select value={failed ?? ""} onChange={(e) => fail(e.target.value || null)} disabled={!arch} className="h-7 max-w-[160px] rounded-md border bg-background px-1.5 text-[13px]">
            <option value="">Pick a service…</option>
            {arch?.graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
          </select>
        </label>
        {failed && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[13px]" onClick={() => fail(null)}>
            <Icon name="restart_alt" size={16} />
            Restore
          </Button>
        )}
        <span className="ml-auto truncate text-muted-foreground">{arch ? `${arch.source} · ${total} services` : ""}</span>
      </div>
      {!failed && arch && (
        <p className="shrink-0 border-b bg-muted/40 px-4 py-1.5 text-[12.5px] font-semibold text-ink-2">
          Click a service to see what breaks when it goes down
        </p>
      )}

      <div className="relative min-h-0 flex-1 bg-paper">
        {error ? (
          <div className="grid h-full place-items-center p-6 text-center text-[14px] text-muted-foreground">
            <div>
              <Icon name="cloud_off" size={28} />
              <p className="mt-2 max-w-[42ch]">{error}</p>
            </div>
          </div>
        ) : (
          <ReactFlow<ServiceNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => fail(n.id === failed ? null : n.id)}
            fitView
            minZoom={0.3}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
          >
            <Background id="minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={0.6} color="var(--grid-minor)" />
            <Background id="major" variant={BackgroundVariant.Lines} gap={120} lineWidth={1} color="var(--grid-major)" />
          </ReactFlow>
        )}
        {busy && <div className="absolute top-3 right-3 rounded-full bg-card px-2.5 py-1 text-[12px] shadow">Working out the blast radius…</div>}
      </div>

      {failed && impact && (
        <div className="max-h-[42%] shrink-0 overflow-y-auto border-t bg-card px-4 py-3">
          <div className="flex items-baseline gap-2">
            <Icon name="crisis_alert" size={18} className="translate-y-[3px] text-flag" />
            <b className="text-[14.5px]">
              {impact.impact.impacted.length
                ? `${failed} down: ${impact.impact.impacted.length} of ${total - 1} services break`
                : `${failed} down: nothing else depends on it`}
            </b>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
            {impact.impact.impacted.map((i) => (
              <li key={i.impacted_service}>
                <b className="text-[var(--agent-reviewer)]">{i.impacted_service}</b>
                <span className="text-muted-foreground"> · {i.via.length === 1 ? "direct" : `via ${i.via.slice(0, -1).join(" → ")}`} · </span>
                <span className="font-mono text-[12px] text-ink-2">{i.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
          {fixes.length > 0 && (
            <>
              <div className="mt-3 text-[13px] font-bold">Suggested fixes</div>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[13px] text-ink-2">
                {fixes.map((f) => <li key={f.service}><b>{f.service}:</b> {f.text}</li>)}
              </ul>
              <p className="mt-1 text-[11.5px] text-muted-foreground">From the dependency rules the engine found ({impact.impact.edge_sources_used.join(", ")}), not from a live test.</p>
            </>
          )}
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-dashed p-3">
            <Icon name="science" size={22} className="text-[var(--agent-analyst)]" />
            <div className="min-w-0 flex-1 text-[12.5px]">
              <b className="text-[13px]">Prove it under real load</b>
              <span className="text-muted-foreground"> · stop {failed} in a sandbox copy of this stack while traffic runs, and measure errors and latency.</span>
            </div>
            <span className="shrink-0 rounded-md bg-[var(--agent-analyst)] px-2 py-1 text-[11.5px] font-bold text-white">Pro</span>
          </div>
        </div>
      )}
    </div>
  )
}
