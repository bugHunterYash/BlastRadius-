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
import { agentColor, cap, ISSUE_TAG } from "@/lib/format"
import { AGENT_META, EVENTS, LAYOUT, PRIOR, DESIGN } from "@/lib/data"
import { Icon } from "@/components/ui/icon"
import { AGENT_ICON } from "./agent-glyph"
import { RuntimeMark, runtimeLine } from "./runtime-logo"
import { seenIssues, useTower } from "./tower-store"

const STAGE = { w: 1000, h: 620 }
const AGENT_SIZE = 96 // the box holds the outer rings; the solid core is much smaller
const AGENT_CORE = 13
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
  /** changes each time this node takes part in the newest Meko call, replaying its ripple */
  active: number | null
  /** stagger for the idle drift */
  drift: number
}
type TowerNode = Node<NodeData>

type EdgeData = {
  op: LinkOp
  /** the agent this link belongs to, for its pulse colour */
  agent: string
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

/** Concentric rings that spread out and fade, like ink dropped in water. */
function Ripples({ color, from, to, count, duration, repeat, delayStart = 0 }: { color: string; from: number; to: number; count: number; duration: number; repeat: boolean; delayStart?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <motion.circle
          key={i}
          fill="none"
          style={{ stroke: color }}
          strokeWidth={1.2}
          initial={{ r: from, opacity: 0 }}
          animate={{ r: to, opacity: [0, 0.75, 0] }}
          transition={{ duration, delay: delayStart + (i * duration) / count, repeat: repeat ? Infinity : 0, ease: "easeOut" }}
        />
      ))}
    </>
  )
}

/** Hop number for the trace, set small beside the node like an index on a map. */
function HopMark({ hop, offset }: { hop: number; offset: number }) {
  return (
    <motion.span
      className="pointer-events-none absolute z-20 font-mono text-[12.5px] font-semibold text-cobalt"
      style={{ left: `calc(50% - ${offset}px)`, top: `calc(50% - ${offset + 6}px)` }}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: hop * HOP_DELAY + 0.2, duration: 0.3 }}
    >
      {String(hop).padStart(2, "0")}
    </motion.span>
  )
}

/** A slow bob so the network feels alive even when nothing is happening. */
const drift = (d: number) => ({ animation: `drift 7s ease-in-out ${-d}s infinite` })

// labels sit on the canvas, kept readable over lines by a halo in the paper colour
const halo = { textShadow: "0 0 3px var(--paper), 0 0 3px var(--paper), 0 0 6px var(--paper)" }

function AgentNode({ id, data }: NodeProps<TowerNode>) {
  const color = agentColor(id)
  return (
    <div className={cn("group relative transition-opacity duration-300", data.dim && "opacity-15")} style={{ width: AGENT_SIZE, height: AGENT_SIZE, ...drift(data.drift) }}>
      <CenterHandles />
      <svg viewBox="-48 -48 96 96" className="absolute inset-0 overflow-visible" aria-hidden>
        {data.flagged && <Ripples color="var(--ripple)" from={AGENT_CORE + 10} to={46} count={3} duration={2.8} repeat />}
        {data.active !== null && <Ripples key={data.active} color={color} from={AGENT_CORE + 8} to={44} count={2} duration={1.2} repeat={false} />}
        {data.hop !== null && <Ripples key={`t${data.traceKey}`} color="var(--cobalt)" from={AGENT_CORE + 8} to={46} count={3} duration={1.4} repeat={false} delayStart={data.hop * HOP_DELAY} />}
        {/* a soft halo in the agent's colour code */}
        <circle r={34} style={{ fill: color }} fillOpacity={0.12} />
        {data.selected && <circle r={40} fill="none" strokeWidth={2} style={{ stroke: color }} strokeDasharray="4 4" />}
      </svg>
      {/* the agent: a solid disc in its colour, with its Material Symbol in white */}
      <span
        className="absolute top-1/2 left-1/2 grid size-[50px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-white ring-4 ring-white transition-transform duration-300 ease-out group-hover:scale-110"
        style={{ background: color, boxShadow: `0 8px 20px -8px ${color}` }}
      >
        <Icon name={AGENT_ICON[id] ?? "smart_toy"} size={26} />
        {/* which runtime runs this agent: Claude Code or Codex */}
        {AGENT_META[id]?.provider && (
          <span className="absolute -right-1.5 -bottom-1.5 grid size-[22px] place-items-center rounded-full bg-white p-[3px] shadow">
            <RuntimeMark provider={AGENT_META[id]?.provider} className="size-full" />
          </span>
        )}
      </span>
      <div
        className={cn("pointer-events-none absolute top-[calc(50%+38px)] left-1/2 -translate-x-1/2 text-center text-[15px] font-bold whitespace-nowrap text-foreground", data.flagged && "text-[var(--ripple)]")}
        style={halo}
      >
        {data.label}
        {runtimeLine(id) && <span className="block text-[10.5px] font-normal text-muted-foreground">{runtimeLine(id)}</span>}
      </div>
      {data.hop !== null && <HopMark key={`h${data.traceKey}`} hop={data.hop} offset={30} />}
    </div>
  )
}

function FactNode({ data }: NodeProps<TowerNode>) {
  const traced = data.hop !== null
  return (
    <div className={cn("group relative grid size-4 place-items-center transition-opacity duration-300", data.dim && "opacity-15")} style={drift(data.drift)}>
      <CenterHandles />
      <svg viewBox="-8 -8 16 16" className="absolute inset-0 overflow-visible" aria-hidden>
        {data.active !== null && <Ripples key={data.active} color="var(--cobalt)" from={5} to={18} count={1} duration={1} repeat={false} />}
        {traced && <Ripples key={`t${data.traceKey}`} color="var(--cobalt)" from={5} to={22} count={2} duration={1.2} repeat={false} delayStart={data.hop! * HOP_DELAY} />}
        {/* a memory item: an emerald key-square, the colour code for anything stored in Meko */}
        <rect x={-6.5} y={-6.5} width={13} height={13} rx={3.5} className="origin-center transition-transform duration-300 [transform-box:fill-box] group-hover:scale-125" style={{ fill: "var(--cobalt)" }} />
        {data.selected && <rect x={-10} y={-10} width={20} height={20} rx={6} fill="none" style={{ stroke: "var(--cobalt)" }} strokeWidth={1} strokeDasharray="2 3" />}
      </svg>
      <div
        className={cn(
          "fact-label pointer-events-none absolute top-1/2 -translate-y-1/2 font-mono text-[13.5px] font-semibold whitespace-nowrap text-ink",
          data.side === "right" ? "left-5" : "right-5",
          data.selected && "font-semibold text-ink",
        )}
        style={halo}
      >
        {data.label}
        {data.version !== null && <span className="ml-1 font-mono text-[12px] text-muted-foreground">v{data.version}</span>}
      </div>
      {traced && <HopMark key={`h${data.traceKey}`} hop={data.hop!} offset={14} />}
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
/** Lines stop at the agent's core rings, or just short of a fact's dot. */
const reachOf = (n: InternalNode) => (n.type === "agent" ? 22 : 7)
const toward = (from: Pt, to: Pt, dist: number): Pt => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist }
}
const cubic = (a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  }
}
/** Stable pseudo-random number in [-1, 1] per link, so each line keeps its own wobble. */
const wobble = (key: string, salt: number) => {
  let h = salt * 7919
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return ((h >>> 0) % 2000) / 1000 - 1
}

/** A bright dot that travels the link once, carrying the newest Meko call. */
function Pulse({ d, color }: { d: string; color: string }) {
  const group = useRef<SVGGElement>(null)
  // SVG animations are timed from page load; start them by hand when the pulse mounts
  useEffect(() => {
    group.current?.querySelectorAll<SVGAnimationElement>("animate, animateMotion").forEach((a) => a.beginElement())
  }, [])
  const motionProps = { dur: "0.9s", begin: "indefinite", fill: "freeze", path: d, keyPoints: "0;1", keyTimes: "0;1", calcMode: "spline", keySplines: "0.4 0 0.2 1" } as const
  const fadeProps = { attributeName: "opacity", keyTimes: "0;0.15;0.8;1", dur: "0.9s", begin: "indefinite", fill: "freeze" } as const
  return (
    <g ref={group}>
      <circle r={10} style={{ fill: color }} opacity={0}>
        <animateMotion {...motionProps} />
        <animate {...fadeProps} values="0;0.2;0.2;0" />
      </circle>
      <circle r={3.5} style={{ fill: color }} opacity={0}>
        <animateMotion {...motionProps} />
        <animate {...fadeProps} values="0;1;1;0" />
      </circle>
    </g>
  )
}

function MemoryEdge({ id, source, target, data }: EdgeProps<TowerEdge>) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  const { go } = useTower()
  if (!s || !t || !data) return null

  // a loose, hand-drawn line: two control points pushed off the straight path by a per-link wobble
  const a = centerOf(s)
  const b = centerOf(t)
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const bend = data.curve * len
  const c1 = { x: a.x + (b.x - a.x) * 0.3 + nx * (bend + wobble(id, 1) * len * 0.09), y: a.y + (b.y - a.y) * 0.3 + ny * (bend + wobble(id, 1) * len * 0.09) }
  const c2 = { x: a.x + (b.x - a.x) * 0.7 + nx * (bend + wobble(id, 2) * len * 0.09), y: a.y + (b.y - a.y) * 0.7 + ny * (bend + wobble(id, 2) * len * 0.09) }
  const p0 = toward(a, c1, reachOf(s))
  const p3 = toward(b, c2, reachOf(t) + (data.op === "handoff" ? 5 : 0))
  const d = `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}`

  const stroke = data.tone === "flag" ? "var(--ripple)" : data.tone === "fixed" ? "var(--mint)" : data.tone === "trace" ? "var(--cobalt)" : "var(--ink)"
  // line weight says what the link carries: writes heavier than reads, handoffs dotted
  const base = data.tone === "default" ? (data.op === "write" ? 0.5 : data.op === "read" ? 0.22 : 0.45) : 1
  const opacity = data.dim ? 0.05 : data.emphasis ? 0.95 : base
  const width = data.tone === "trace" ? 2 : data.tone === "flag" ? 1.4 : data.op === "write" ? 1.3 : 0.9

  const tip = cubic(p0, c1, c2, p3, 0.7)
  const back = cubic(p0, c1, c2, p3, 0.66)
  const ang = Math.atan2(tip.y - back.y, tip.x - back.x)
  const arrow = [0, 2.5, -2.5].map((da) => `${tip.x + Math.cos(ang + da) * 4.5},${tip.y + Math.sin(ang + da) * 4.5}`)
  const label = cubic(p0, c1, c2, p3, data.labelAt)
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { delay: (data.hop ?? 0) * HOP_DELAY, duration: 0.6, ease: "easeInOut" as const } }

  return (
    <g style={{ transition: "opacity 300ms" }} opacity={opacity}>
      {data.tone === "trace" ? (
        <>
          <motion.path key={`glow${data.traceKey}`} d={d} fill="none" stroke={stroke} strokeWidth={9} strokeLinecap="round" opacity={0.14} style={{ filter: "blur(3px)" }} {...draw} />
          <motion.path key={`line${data.traceKey}`} id={id} d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" {...draw} />
        </>
      ) : (
        <>
          {data.tone === "flag" && <path d={d} fill="none" stroke={stroke} strokeWidth={8} strokeLinecap="round" opacity={0.18} style={{ filter: "blur(4px)" }} />}
          <path id={id} d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeDasharray={data.op === "handoff" ? "0.5 5" : data.op === "read" && data.tone === "default" ? "3 4" : undefined} />
        </>
      )}
      {data.op === "handoff" && !data.dim && <polygon points={arrow.join(" ")} fill={stroke} />}
      {data.pulse !== null && <Pulse key={data.pulse} d={d} color={data.tone === "flag" ? "var(--ripple)" : agentColor(data.agent)} />}
      {!data.dim && data.tone === "flag" && (
        <circle r={2} fill={stroke}>
          <animateMotion dur="3.4s" repeatCount="indefinite" path={d} />
        </circle>
      )}
      {data.tag && !data.dim && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={() => data.issueId && go("issue", data.issueId)}
            className={cn(
              "nodrag nopan absolute inline-flex h-6 items-center gap-1.5 rounded-full border bg-paper px-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors hover:bg-muted",
              data.tone === "fixed" ? "border-mint/30 text-mint" : "border-[var(--ripple)]/30 text-[var(--ripple)]",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, pointerEvents: "all" }}
          >
            <span className="size-1.5 rounded-full bg-current" />
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

/** One node per agent and fact of the loaded run (LAYOUT changes when a live run loads). */
const buildNodes = (portrait = false): TowerNode[] =>
  Object.entries(LAYOUT).map(([id, p], i) => {
    const kind = DESIGN.agents.includes(id) ? "agent" : "fact"
    const edge = portrait ? p.y : p.x
    return {
      id,
      type: kind,
      position: place(id, portrait),
      data: { kind, label: kind === "agent" ? cap(id) : id, version: null, side: edge > 0.9 ? "left" : "right", dim: false, selected: false, flagged: false, hop: null, traceKey: 0, active: null, drift: i * 1.3 },
    }
  })

export function MemoryGraph({ showReads = true, showHandoffs = true, showLabels = true }: { showReads?: boolean; showHandoffs?: boolean; showLabels?: boolean }) {
  const { state, go } = useTower()
  const { view, mode, replayN, trace, traceKey, issues, highlight } = state
  const [nodes, setNodes, onNodesChange] = useNodesState<TowerNode>(buildNodes())
  const { fitView } = useReactFlow()
  const wrap = useRef<HTMLDivElement>(null)
  const [portrait, setPortrait] = useState(false)
  const measured = useNodesInitialized()

  // a different run (or the first live load) brings its own agents and facts
  useEffect(() => {
    if (!state.loaded) return
    setNodes(buildNodes(portrait))
    const raf = requestAnimationFrame(() => fitView({ padding: 0.12 }))
    return () => cancelAnimationFrame(raf)
    // portrait is handled by the effect below; only a data load rebuilds the node set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loaded, state.runId, setNodes, fitView])

  // re-lay the network when the panel switches between tall and wide
  useEffect(() => {
    if (!measured) return
    setNodes((ns) =>
      ns.filter((n) => LAYOUT[n.id]).map((n) => {
        const p = LAYOUT[n.id]
        const edge = portrait ? p.y : p.x
        return { ...n, position: place(n.id, portrait), data: { ...n.data, side: edge > 0.85 ? "left" : "right" } }
      }),
    )
    const raf = requestAnimationFrame(() => fitView({ padding: 0.1 }))
    return () => cancelAnimationFrame(raf)
  }, [portrait, measured, setNodes, fitView])

  // state.loaded: EVENTS is replaced when a run loads, so recompute even if the counts match
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const links = useMemo(() => buildLinks(EVENTS, issues, replayN).filter((l) => LAYOUT[l.source] && LAYOUT[l.target]), [issues, replayN, state.loaded])
  const seen = useMemo(() => seenIssues(state), [state])
  // the newest Meko call; its link pulses and the nodes at both ends ripple
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
      links.filter((l) => (showReads || l.op !== "read") && (showHandoffs || l.op !== "handoff")).map((l) => {
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
            agent: l.op === "read" ? l.target : l.source,
            tone: trace ? (traced ? "trace" : "default") : open ? "flag" : fixed ? "fixed" : "default",
            dim,
            emphasis: (state.playing && l.key === newestKey) || lit?.key === l.key,
            pulse: l.key === newestKey ? replayN : null,
            tag: trace || !l.issue ? null : open ? ISSUE_TAG[l.issue.type] : fixed ? "Fixed" : null,
            issueId: l.issue?.issue_id ?? null,
            curve: l.op === "handoff" ? -0.18 : l.op === "read" ? 0.06 : -0.06,
            labelAt: l.issue?.type === "permission_leak" ? 0.3 : 0.5,
            hop: trace ? Math.max(trace.hops.get(l.source) ?? 0, trace.hops.get(l.target) ?? 0) : null,
            traceKey,
          },
        }
      }),
    [links, trace, traceKey, focusNode, focusIssue, lit, newestKey, state.playing, replayN, showReads, showHandoffs],
  )

  // keep the whole network in view once nodes are measured, and whenever the column changes size
  useEffect(() => {
    if (!wrap.current || !measured) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!width || !height) return
      setPortrait(height > width * 1.15)
      fitView({ padding: 0.1 })
    })
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [fitView, measured])

  return (
    <div ref={wrap} className={cn("absolute inset-x-0 top-14 bottom-0", !showLabels && "hide-labels")}>
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
        aria-label={`Memory graph of ${state.runId}: ${DESIGN.agents.length} agents and the facts they read and write`}
      >
        {/* graph paper: fine lines every 24px, stronger ones every 120px */}
        <Background id="minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={0.6} color="var(--grid-minor)" />
        <Background id="major" variant={BackgroundVariant.Lines} gap={120} lineWidth={1} color="var(--grid-major)" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
