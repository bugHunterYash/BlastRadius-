"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  useInternalNode,
  useNodesInitialized,
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
import { seenIssues, useTower } from "./tower-store"

const STAGE = { w: 1000, h: 620 }
const AGENT_SIZE = 44
const FACT_SIZE = 16
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
  /** changes each time this node takes part in the newest Meko call, replaying its flash */
  active: number | null
  /** stagger for the idle drift */
  drift: number
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
  /** changes each time this link carries the newest Meko call, sending a pulse along it */
  pulse: number | null
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

/** Hop number for the trace, set small beside the node like an index on a map. */
function HopMark({ hop, offset }: { hop: number; offset: number }) {
  return (
    <motion.span
      className="pointer-events-none absolute z-20 font-mono text-[11px] font-medium text-cobalt"
      style={{ left: -offset, top: -offset - 4 }}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: hop * HOP_DELAY + 0.2, duration: 0.3 }}
    >
      {String(hop).padStart(2, "0")}
    </motion.span>
  )
}

/** A soft bloom when a node takes part in the newest Meko call. */
function Bloom({ size }: { size: number }) {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute rounded-full bg-cobalt"
      style={{ left: "50%", top: "50%", width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
      initial={{ scale: 1, opacity: 0.35 }}
      animate={{ scale: 2.6, opacity: 0 }}
      transition={{ duration: 1.1, ease: "easeOut" }}
    />
  )
}

/** A slow bob so the network feels alive even when nothing is happening. */
const drift = (d: number) => ({ animation: `drift 7s ease-in-out ${-d}s infinite` })

// labels sit on the canvas, kept readable over lines by a halo in the canvas colour
const halo = { textShadow: "0 0 3px var(--card), 0 0 3px var(--card), 0 0 6px var(--card)" }

function AgentNode({ data }: NodeProps<TowerNode>) {
  return (
    <div className={cn("group relative size-11 transition-opacity duration-300", data.dim && "opacity-20")} style={drift(data.drift)}>
      <CenterHandles />
      {data.active !== null && <Bloom key={data.active} size={44} />}
      {data.hop !== null && <TraceHalo key={data.traceKey} hop={data.hop} size={170} />}
      {/* an open issue shows as a warm glow around the agent, not a badge */}
      {data.flagged && <span className="motion-safe-pulse absolute -inset-4 rounded-full bg-flag/25 blur-md [animation:glow_3s_ease-in-out_infinite]" />}
      <div
        className={cn(
          "relative z-10 size-11 rounded-full bg-cobalt transition-transform duration-300 ease-out group-hover:scale-110",
          data.selected && "ring-1 ring-cobalt/50 ring-offset-[5px] ring-offset-card",
        )}
      />
      <div
        className={cn("pointer-events-none absolute top-full left-1/2 mt-2.5 -translate-x-1/2 text-[13px] font-medium whitespace-nowrap text-foreground", data.flagged && "text-flag")}
        style={halo}
      >
        {data.label}
      </div>
      {data.hop !== null && <HopMark key={`h${data.traceKey}`} hop={data.hop} offset={10} />}
    </div>
  )
}

function FactNode({ data }: NodeProps<TowerNode>) {
  return (
    <div className={cn("group relative grid size-4 place-items-center transition-opacity duration-300", data.dim && "opacity-20")} style={drift(data.drift)}>
      <CenterHandles />
      {data.active !== null && <Bloom key={data.active} size={9} />}
      {data.hop !== null && <TraceHalo key={data.traceKey} hop={data.hop} size={100} />}
      <div
        className={cn(
          "relative z-10 size-[9px] rounded-full bg-cobalt transition-transform duration-300 group-hover:scale-150",
          data.selected && "ring-1 ring-cobalt/50 ring-offset-4 ring-offset-card",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-[12.5px] whitespace-nowrap text-ink-2",
          data.side === "right" ? "left-5" : "right-5",
          data.selected && "font-medium text-foreground",
        )}
        style={halo}
      >
        {data.label}
        {data.version !== null && <span className="ml-1 font-mono text-[10.5px] text-muted-foreground">v{data.version}</span>}
      </div>
      {data.hop !== null && <HopMark key={`h${data.traceKey}`} hop={data.hop} offset={12} />}
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

/** A bright dot that travels the link once, carrying the newest Meko call. */
function Pulse({ d, color }: { d: string; color: string }) {
  const group = useRef<SVGGElement>(null)
  // SVG animations are timed from page load; start them by hand when the pulse mounts
  useEffect(() => {
    group.current?.querySelectorAll<SVGAnimationElement>("animate, animateMotion").forEach((a) => a.beginElement())
  }, [])
  const motionProps = { dur: "0.85s", begin: "indefinite", fill: "freeze", path: d, keyPoints: "0;1", keyTimes: "0;1", calcMode: "spline", keySplines: "0.4 0 0.2 1" } as const
  const fadeProps = { attributeName: "opacity", keyTimes: "0;0.15;0.8;1", dur: "0.85s", begin: "indefinite", fill: "freeze" } as const
  return (
    <g ref={group}>
      <circle r={10} fill={color} opacity={0}>
        <animateMotion {...motionProps} />
        <animate {...fadeProps} values="0;0.18;0.18;0" />
      </circle>
      <circle r={3.5} fill={color} opacity={0}>
        <animateMotion {...motionProps} />
        <animate {...fadeProps} values="0;1;1;0" />
      </circle>
    </g>
  )
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
  // line weight says what the link carries: writes heavier than reads, handoffs dotted
  const baseOpacity = data.tone === "default" ? (data.op === "write" ? 0.55 : data.op === "read" ? 0.28 : 0.6) : 1
  const opacity = data.dim ? 0.06 : data.emphasis ? 1 : baseOpacity
  const width = data.tone === "trace" ? 2 : data.tone === "flag" ? 1.5 : data.op === "write" ? 1.75 : 1

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
        <>
          {/* a problem link carries a soft blurred glow under it */}
          {data.tone === "flag" && <path d={d} fill="none" stroke={stroke} strokeWidth={9} strokeLinecap="round" opacity={0.22} style={{ filter: "blur(4px)" }} />}
          <path id={id} d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeDasharray={data.op === "handoff" ? "0.5 5" : undefined} />
        </>
      )}
      {data.op === "handoff" && !data.dim && <polygon points={arrow.join(" ")} fill={stroke} />}
      {data.pulse !== null && <Pulse key={data.pulse} d={d} color={data.tone === "flag" ? "var(--flag)" : "var(--cobalt)"} />}
      {!data.dim && data.tone === "flag" && (
        <circle r={2.2} fill={stroke}>
          <animateMotion dur="3.2s" repeatCount="indefinite" path={d} />
        </circle>
      )}
      {data.tag && !data.dim && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={() => data.issueId && go("issue", data.issueId)}
            className={cn(
              "nodrag nopan absolute inline-flex h-6 items-center rounded-full border bg-card/95 px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-colors hover:bg-muted",
              data.tone === "fixed" ? "border-mint/30 text-mint" : "border-flag/30 text-flag",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, pointerEvents: "all" }}
          >
            {data.tag}
          </button>
        </EdgeLabelRenderer>
      )}
    </g>
  )
}

const edgeTypes = { memory: MemoryEdge }

/* ---------- graph ---------- */

/** Where a node sits; in a tall panel the layout turns on its side so the agents run top to bottom. */
function place(id: string, portrait: boolean) {
  const p = LAYOUT[id]
  const size = DESIGN.agents.includes(id) ? AGENT_SIZE : FACT_SIZE
  const x = portrait ? p.y * STAGE.h : p.x * STAGE.w
  const y = portrait ? p.x * STAGE.w : p.y * STAGE.h
  return { x: x - size / 2, y: y - size / 2 }
}

const initialNodes: TowerNode[] = Object.entries(LAYOUT).map(([id, p], i) => {
  const kind = DESIGN.agents.includes(id) ? "agent" : "fact"
  return {
    id,
    type: kind,
    position: place(id, false),
    data: { kind, label: kind === "agent" ? cap(id) : id, version: null, side: p.x > 0.9 ? "left" : "right", dim: false, selected: false, flagged: false, hop: null, traceKey: 0, active: null, drift: i * 1.3 },
  }
})

export function MemoryGraph() {
  const { state, go } = useTower()
  const { view, mode, replayN, trace, traceKey, issues, highlight } = state
  const [nodes, setNodes, onNodesChange] = useNodesState<TowerNode>(initialNodes)
  const { fitView } = useReactFlow()
  const wrap = useRef<HTMLDivElement>(null)
  const [portrait, setPortrait] = useState(false)
  const measured = useNodesInitialized()

  // re-lay the network when the panel switches between tall and wide
  useEffect(() => {
    if (!measured) return
    setNodes((ns) =>
      ns.map((n) => {
        const p = LAYOUT[n.id]
        const edge = portrait ? p.y : p.x
        return { ...n, position: place(n.id, portrait), data: { ...n.data, side: edge > 0.85 ? "left" : "right" } }
      }),
    )
    const raf = requestAnimationFrame(() => fitView({ padding: 0.12 }))
    return () => cancelAnimationFrame(raf)
  }, [portrait, measured, setNodes, fitView])

  const links = useMemo(() => buildLinks(EVENTS, issues, replayN), [issues, replayN])
  const seen = useMemo(() => seenIssues(state), [state])
  // the newest Meko call; its link pulses and the nodes at both ends flash
  const newest = replayN > 0 && !trace ? EVENTS[replayN - 1] : null
  const newestKey = newest ? linkKey(newest) : null
  const newestEnds = useMemo(() => new Set(newest ? [newest.agent, newest.fact_key ?? newest.target_agent ?? ""] : []), [newest])

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
            flagged: !trace && n.data.kind === "agent" && seen.some((i) => isOpen(i) && i.agent === id),
            hop: trace?.hops.get(id) ?? null,
            traceKey,
            active: newestEnds.has(id) ? replayN : null,
            version: n.data.kind === "fact" ? latestVersion(id, EVENTS, PRIOR, replayN)?.version ?? null : null,
          },
        }
      }),
    )
  }, [links, focusNode, focusIssue, lit, trace, traceKey, mode, seen, newestEnds, replayN, setNodes])

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
            emphasis: (state.playing && l.key === newestKey) || lit?.key === l.key,
            pulse: l.key === newestKey ? replayN : null,
            tag: trace || !l.issue ? null : open ? ISSUE_TAG[l.issue.type] : fixed ? "Fixed" : null,
            issueId: l.issue?.issue_id ?? null,
            curve: l.op === "handoff" ? -0.22 : l.op === "read" ? 0.1 : -0.1,
            labelAt: l.issue?.type === "permission_leak" ? 0.3 : 0.5,
            hop: trace ? Math.max(trace.hops.get(l.source) ?? 0, trace.hops.get(l.target) ?? 0) : null,
            traceKey,
          },
        }
      }),
    [links, trace, traceKey, focusNode, focusIssue, lit, newestKey, state.playing, replayN],
  )

  // keep the whole network in view once nodes are measured, and whenever the column changes size
  useEffect(() => {
    if (!wrap.current || !measured) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!width || !height) return
      setPortrait(height > width * 1.15)
      fitView({ padding: 0.12 })
    })
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [fitView, measured])

  return (
    <div ref={wrap} className="absolute inset-x-0 top-14 bottom-10">
      <ReactFlow<TowerNode, TowerEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => go(n.data.kind, n.id)}
        nodesConnectable={false}
        elementsSelectable={false}
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
