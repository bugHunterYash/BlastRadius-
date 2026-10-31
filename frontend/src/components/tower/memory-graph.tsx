"use client"

import { useEffect, useMemo, useRef } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  useInternalNode,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { buildLinks, isOpen, latestVersion, linkKey, type LinkOp } from "@/lib/graph"
import { cap, ISSUE_TAG } from "@/lib/format"
import { EVENTS, LAYOUT, PRIOR, DESIGN } from "@/lib/sample-data"
import { useTower } from "./tower-store"

const STAGE = { w: 1000, h: 620 }
const AGENT_SIZE = 64
const FACT_SIZE = 14
const HOP_DELAY = 0.45 // seconds between trace hops

type NodeData = {
  kind: "agent" | "fact"
  label: string
  version: number | null
  side: "left" | "right"
  dim: boolean
  selected: boolean
  flagged: boolean
  hop: number | null
  traceKey: number
}
type TowerNode = Node<NodeData>

type EdgeData = {
  op: LinkOp
  tone: "default" | "flag" | "fixed" | "trace"
  dim: boolean
  emphasis: boolean
  tag: string | null
  issueId: string | null
  curve: number
  labelAt: number
  hop: number | null
  traceKey: number
}
type TowerEdge = Edge<EdgeData, "memory">

/* ---------- nodes ---------- */

const handleClass = "!pointer-events-none !left-1/2 !top-1/2 !size-px !min-h-0 !min-w-0 !border-0 !opacity-0"
function CenterHandles() {
  return (
    <>
      <Handle type="source" position={Position.Top} isConnectable={false} className={handleClass} />
      <Handle type="target" position={Position.Top} isConnectable={false} className={handleClass} />
    </>
  )
}

function TraceHalo({ hop, size }: { hop: number; size: number }) {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute rounded-full"
      style={{
        left: "50%",
        top: "50%",
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        background: "radial-gradient(circle, color-mix(in oklab, var(--cobalt) 24%, transparent) 0%, transparent 68%)",
      }}
      initial={{ scale: 0.2, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: hop * HOP_DELAY, duration: 0.7, ease: "easeOut" }}
    />
  )
}

function HopBadge({ hop, offset }: { hop: number; offset: number }) {
  return (
    <motion.span
      className="pointer-events-none absolute z-20 grid h-5 min-w-5 place-items-center rounded-full bg-cobalt px-1.5 font-mono text-[10.5px] font-medium text-primary-foreground"
      style={{ left: -offset, top: -offset }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: hop * HOP_DELAY + 0.2, type: "spring", stiffness: 400, damping: 22 }}
    >
      {hop}
    </motion.span>
  )
}

function AgentNode({ data }: NodeProps<TowerNode>) {
  return (
    <div className={cn("relative size-16 transition-opacity duration-300", data.dim && "opacity-20")}>
      <CenterHandles />
      {data.hop !== null && <TraceHalo key={data.traceKey} hop={data.hop} size={190} />}
      {data.flagged && (
        <span className="motion-safe-pulse absolute inset-0 rounded-full border border-flag/60 [animation:pulse-ring_2.6s_ease-out_infinite]" />
      )}
      <div
        className={cn(
          "relative z-10 grid size-16 place-items-center rounded-full bg-cobalt text-[11.5px] font-medium text-primary-foreground",
          "shadow-[0_10px_24px_-10px_var(--cobalt)] transition-[transform,box-shadow] duration-200 hover:scale-[1.04]",
          data.selected && "ring-[6px] ring-cobalt/15",
        )}
      >
        {data.label}
      </div>
      {data.flagged && <span className="absolute top-0.5 right-0.5 z-20 size-3.5 rounded-full border-[3px] border-background bg-flag" />}
      {data.hop !== null && <HopBadge key={`h${data.traceKey}`} hop={data.hop} offset={6} />}
    </div>
  )
}

function FactNode({ data }: NodeProps<TowerNode>) {
  return (
    <div className={cn("relative size-3.5 transition-opacity duration-300", data.dim && "opacity-20")}>
      <CenterHandles />
      {data.hop !== null && <TraceHalo key={data.traceKey} hop={data.hop} size={120} />}
      <div
        className={cn(
          "relative z-10 size-3.5 rounded-full border-[1.5px] border-cobalt bg-card transition-transform duration-200 hover:scale-125",
          data.selected && "bg-cobalt ring-4 ring-cobalt/15",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-md bg-background/85 px-1.5 py-0.5 text-[13px] whitespace-nowrap text-ink-2 backdrop-blur-[2px]",
          data.side === "right" ? "left-5" : "right-5",
          data.selected && "font-medium text-foreground",
        )}
      >
        {data.label}
        {data.version !== null && <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">v{data.version}</span>}
      </div>
      {data.hop !== null && <HopBadge key={`h${data.traceKey}`} hop={data.hop} offset={14} />}
    </div>
  )
}

const nodeTypes = { agent: AgentNode, fact: FactNode }

/* ---------- edges ---------- */

type Pt = { x: number; y: number }
const centerOf = (n: InternalNode): Pt => ({
  x: n.internals.positionAbsolute.x + (n.measured.width ?? 0) / 2,
  y: n.internals.positionAbsolute.y + (n.measured.height ?? 0) / 2,
})
const radiusOf = (n: InternalNode) => (n.measured.width ?? 0) / 2
const toward = (from: Pt, to: Pt, dist: number): Pt => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist }
}
const quad = (a: Pt, c: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }
}

const STROKE: Record<EdgeData["tone"], string> = {
  default: "var(--cobalt)",
  flag: "var(--flag)",
  fixed: "var(--mint)",
  trace: "var(--cobalt)",
}

function MemoryEdge({ id, source, target, data }: EdgeProps<TowerEdge>) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  const { go } = useTower()
  if (!s || !t || !data) return null

  const a = centerOf(s)
  const b = centerOf(t)
  const c = { x: (a.x + b.x) / 2 - (b.y - a.y) * data.curve, y: (a.y + b.y) / 2 + (b.x - a.x) * data.curve }
  const p0 = toward(a, c, radiusOf(s) + 3)
  const p2 = toward(b, c, radiusOf(t) + (data.op === "handoff" ? 7 : 3))
  const d = `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p2.x} ${p2.y}`

  const stroke = data.op === "handoff" && data.tone === "default" ? "var(--muted-foreground)" : STROKE[data.tone]
  const baseOpacity = data.tone === "default" ? (data.op === "write" ? 0.6 : data.op === "read" ? 0.3 : 0.5) : 1
  const opacity = data.dim ? 0.07 : data.emphasis ? 1 : baseOpacity
  const width = data.tone === "trace" ? 2 : data.tone === "flag" || data.emphasis ? 1.6 : 1.2

  // small arrowhead for handoffs
  const tip = quad(p0, c, p2, 0.72)
  const back = quad(p0, c, p2, 0.68)
  const ang = Math.atan2(tip.y - back.y, tip.x - back.x)
  const arrow = [0, 2.5, -2.5].map((da) => `${tip.x + Math.cos(ang + da) * 5},${tip.y + Math.sin(ang + da) * 5}`)

  const label = quad(p0, c, p2, data.labelAt)

  return (
    <g style={{ transition: "opacity 300ms" }} opacity={opacity}>
      {data.tone === "trace" ? (
        <>
          <motion.path
            key={`glow${data.traceKey}`}
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={8}
            strokeLinecap="round"
            opacity={0.12}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: (data.hop ?? 0) * HOP_DELAY, duration: 0.6, ease: "easeInOut" }}
          />
          <motion.path
            key={`line${data.traceKey}`}
            id={id}
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={width}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: (data.hop ?? 0) * HOP_DELAY, duration: 0.6, ease: "easeInOut" }}
          />
        </>
      ) : (
        <path id={id} d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeDasharray={data.op === "handoff" ? "3 5" : undefined} />
      )}
      {data.op === "handoff" && !data.dim && <polygon points={arrow.join(" ")} fill={stroke} />}
      {!data.dim && data.op !== "handoff" && data.tone !== "trace" && (
        <circle r={data.tone === "flag" ? 2.6 : 1.8} fill={stroke}>
          <animateMotion dur={data.tone === "flag" ? "2.8s" : "6s"} repeatCount="indefinite" path={d} />
        </circle>
      )}
      {data.tag && !data.dim && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={() => data.issueId && go("issue", data.issueId)}
            className={cn(
              "nodrag nopan absolute inline-flex h-7 items-center gap-2 rounded-full border bg-card px-3 text-xs font-medium whitespace-nowrap shadow-[0_4px_14px_-6px_rgb(0_0_0/0.18)] transition-colors hover:border-foreground/30",
              data.tone === "fixed" ? "text-mint" : "text-foreground",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, pointerEvents: "all" }}
          >
            <span className={cn("size-1.5 rounded-full", data.tone === "fixed" ? "bg-mint" : "bg-flag")} />
            {data.tag}
          </button>
        </EdgeLabelRenderer>
      )}
    </g>
  )
}

const edgeTypes = { memory: MemoryEdge }

/* ---------- graph ---------- */

const initialNodes: TowerNode[] = Object.entries(LAYOUT).map(([id, p]) => {
  const kind = DESIGN.agents.includes(id) ? "agent" : "fact"
  const size = kind === "agent" ? AGENT_SIZE : FACT_SIZE
  return {
    id,
    type: kind,
    position: { x: p.x * STAGE.w - size / 2, y: p.y * STAGE.h - size / 2 },
    data: { kind, label: kind === "agent" ? cap(id) : id, version: null, side: p.x > 0.9 ? "left" : "right", dim: false, selected: false, flagged: false, hop: null, traceKey: 0 },
  }
})

export function MemoryGraph() {
  const { state, go } = useTower()
  const { view, mode, replayN, trace, traceKey, issues, highlight } = state
  const [nodes, setNodes, onNodesChange] = useNodesState<TowerNode>(initialNodes)
  const { fitView } = useReactFlow()
  const wrap = useRef<HTMLDivElement>(null)

  const links = useMemo(() => buildLinks(EVENTS, issues, replayN), [issues, replayN])

  const focusNode = view.kind === "agent" || view.kind === "fact" ? view.id : null
  const focusIssue = view.kind === "issue" ? issues.find((i) => i.issue_id === view.id) ?? null : null
  // a message picked in the shared chat lights up the link it made
  const lit = useMemo(() => {
    const e = highlight ? EVENTS.find((x) => x.event_id === highlight) : undefined
    if (!e) return null
    const l = links.find((x) => x.key === linkKey(e))
    return l ? { key: l.key, ends: new Set([l.source, l.target]) } : null
  }, [highlight, links])

  useEffect(() => {
    const touched = new Set(links.flatMap((l) => [l.source, l.target]))
    const neighbours = new Set(focusNode ? links.filter((l) => l.source === focusNode || l.target === focusNode).flatMap((l) => [l.source, l.target]) : [])
    setNodes((ns) =>
      ns.map((n) => {
        const id = n.id
        let dim = false
        if (trace) dim = !trace.hops.has(id)
        else if (lit) dim = !lit.ends.has(id)
        else if (mode === "replay") dim = n.data.kind === "fact" && !touched.has(id)
        else if (focusNode) dim = !neighbours.has(id) && id !== focusNode
        else if (focusIssue) dim = id !== focusIssue.agent && id !== focusIssue.fact_key
        return {
          ...n,
          data: {
            ...n.data,
            dim,
            selected: focusNode === id,
            flagged: !trace && n.data.kind === "agent" && issues.some((i) => isOpen(i) && i.agent === id),
            hop: trace?.hops.get(id) ?? null,
            traceKey,
            version: n.data.kind === "fact" ? latestVersion(id, EVENTS, PRIOR, replayN)?.version ?? null : null,
          },
        }
      }),
    )
  }, [links, focusNode, focusIssue, lit, trace, traceKey, mode, issues, replayN, setNodes])

  const edges = useMemo<TowerEdge[]>(
    () =>
      links.map((l) => {
        const open = !!l.issue && isOpen(l.issue)
        const fixed = l.issue?.status === "approved"
        const traced = !!trace?.links.has(l.key)
        let dim = false
        if (trace) dim = !traced
        else if (lit) dim = l.key !== lit.key
        else if (focusNode) dim = l.source !== focusNode && l.target !== focusNode
        else if (focusIssue) dim = l.issue?.issue_id !== focusIssue.issue_id
        return {
          id: l.key,
          source: l.source,
          target: l.target,
          type: "memory",
          data: {
            op: l.op,
            tone: trace ? (traced ? "trace" : "default") : open ? "flag" : fixed ? "fixed" : "default",
            dim,
            emphasis: (mode === "replay" && l.last === replayN - 1) || lit?.key === l.key,
            tag: trace || !l.issue ? null : open ? ISSUE_TAG[l.issue.type] : fixed ? "Fixed" : null,
            issueId: l.issue?.issue_id ?? null,
            curve: l.op === "handoff" ? -0.22 : l.op === "read" ? 0.1 : -0.1,
            labelAt: l.issue?.type === "permission_leak" ? 0.3 : 0.5,
            hop: trace ? Math.max(trace.hops.get(l.source) ?? 0, trace.hops.get(l.target) ?? 0) : null,
            traceKey,
          },
        }
      }),
    [links, trace, traceKey, focusNode, focusIssue, lit, mode, replayN],
  )

  // keep the whole network in view when the panel or window changes size
  useEffect(() => {
    if (!wrap.current) return
    const ro = new ResizeObserver(() => fitView({ padding: 0.1, duration: 200 }))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [fitView])

  return (
    <div ref={wrap} className="absolute inset-0">
      <ReactFlow<TowerNode, TowerEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => go(n.data.kind, n.id)}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.4}
        maxZoom={2}
        aria-label="Memory graph of run-42: four agents and the facts they read and write"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--dots)" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
