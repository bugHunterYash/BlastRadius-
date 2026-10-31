"use client"

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ReactFlowProvider } from "@xyflow/react"
import { Icon } from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { CallKind } from "@/lib/types"
import { Counters } from "./counters"
import { MemoryGraph } from "./memory-graph"
import { ActivityStrip } from "./activity-strip"
import { ReplayBar } from "./replay-bar"
import { SharedChat, useVisibleCalls } from "./shared-chat"
import { useTower } from "./tower-store"

const MIN_PANEL = 380
const MIN_CHAT = 440

/** Chat in the main column, the graph beside it like an artifact panel: resizable, foldable, or full screen. */
export function Workspace() {
  const { state } = useTower()
  const { graphView } = state
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [dragging, setDragging] = useState(false)

  const onDrag = useCallback((e: PointerEvent) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    setWidth(Math.min(Math.max(rect.right - e.clientX, MIN_PANEL), rect.width - MIN_CHAT))
  }, [])

  useEffect(() => {
    if (!dragging) return
    const up = () => setDragging(false)
    window.addEventListener("pointermove", onDrag)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", onDrag)
      window.removeEventListener("pointerup", up)
    }
  }, [dragging, onDrag])

  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault()
    setDragging(true)
  }

  return (
    <div ref={box} className={cn("flex min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden", dragging && "cursor-col-resize select-none")}>
      {graphView !== "full" && (
        <main aria-label="Shared memory chat" className="h-[80vh] min-h-0 min-w-0 shrink-0 lg:h-auto lg:flex-1 lg:shrink">
          <SharedChat />
        </main>
      )}

      {graphView === "panel" && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize graph panel"
          onPointerDown={startDrag}
          className="group relative hidden w-3 shrink-0 cursor-col-resize lg:block"
        >
          <span className={cn("absolute inset-y-1/2 left-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-foreground/25", dragging && "bg-primary")} />
        </div>
      )}

      <section
        aria-label="Memory graph"
        className={cn(
          // a white card floating on the tinted page, like the product panels on Upstash
          "flex min-h-0 shrink-0 flex-col overflow-hidden border-t bg-card lg:my-3 lg:mr-3 lg:rounded-2xl lg:border lg:shadow-[0_1px_2px_rgb(18_32_26/0.04),0_12px_32px_-16px_rgb(18_32_26/0.12)]",
          graphView === "panel" && "h-[70vh] min-h-[460px] lg:h-auto lg:w-[var(--panel-w)]",
          graphView === "collapsed" && "h-14 lg:h-auto lg:w-14",
          graphView === "full" && "h-[85vh] flex-1 lg:h-auto",
        )}
        style={{ "--panel-w": `${width}px` } as React.CSSProperties}
      >
        {graphView === "collapsed" ? <CollapsedStrip /> : <GraphPane />}
      </section>
    </div>
  )
}

function GraphPane() {
  const { state, setGraphView } = useTower()
  const full = state.graphView === "full"
  const [showReads, setShowReads] = useState(true)
  const [showHandoffs, setShowHandoffs] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="text-[15px] font-semibold">Memory graph</span>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", state.playing ? "animate-pulse bg-flag" : "bg-mint")} />
          {state.mode === "trace" ? "Trace" : state.mode === "replay" ? "Replay" : state.playing ? "Live" : "Run ended"}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={full ? "Show the chat again" : "Expand the graph"} onClick={() => setGraphView(full ? "panel" : "full")}>
            <Icon name={full ? "close_fullscreen" : "open_in_full"} size={20} />
          </Button>
          {!full && (
            <Button variant="ghost" size="icon-sm" className="hidden text-muted-foreground lg:inline-flex" aria-label="Fold the graph away" onClick={() => setGraphView("collapsed")}>
              <Icon name="right_panel_close" size={20} />
            </Button>
          )}
        </div>
      </div>
      {/* what the graph draws */}
      <div className="flex h-11 shrink-0 items-center gap-5 overflow-x-auto border-b px-4 text-[13.5px] font-semibold text-ink-2">
        <Toggle id="t-reads" label="Reads" checked={showReads} onChange={setShowReads} />
        <Toggle id="t-handoffs" label="Handoffs" checked={showHandoffs} onChange={setShowHandoffs} />
        <Toggle id="t-labels" label="Memory names" checked={showLabels} onChange={setShowLabels} />
      </div>
      <div className="relative min-h-0 flex-1 bg-paper">
        <ReactFlowProvider>
          <MemoryGraph showReads={showReads} showHandoffs={showHandoffs} showLabels={showLabels} />
        </ReactFlowProvider>
        <Counters />
        <GraphKey />
        <ReplayBar />
      </div>
      <ActivityStrip />
    </>
  )
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  )
}

/** What the colours and shapes mean, always visible in the corner of the graph. */
function GraphKey() {
  const { state } = useTower()
  if (state.mode === "replay") return null
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden flex-col gap-1.5 rounded-xl border bg-card/90 sm:flex px-3 py-2.5 text-[13px] text-ink-2 backdrop-blur-sm">
      <span className="flex items-center gap-2">
        <span className="size-3 rounded-full border-[1.5px]" style={{ borderColor: "var(--agent-researcher)", background: "color-mix(in oklab, var(--agent-researcher) 10%, white)" }} />
        Agent, one colour each
      </span>
      <span className="flex items-center gap-2">
        <span className="size-2.5 rounded-[3px] bg-primary" />
        Memory in Meko
      </span>
      <span className="flex items-center gap-2">
        <span className="w-3 border-t-[1.5px] border-ink/60" />
        Write
        <span className="ml-1 w-3 border-t border-dashed border-ink/50" />
        Read / handoff
      </span>
      <span className="flex items-center gap-2">
        <span className="size-3 rounded-full border border-[var(--ripple)] bg-[var(--ripple)]/15" />
        Needs review
      </span>
    </div>
  )
}

const STRIP: { kind: CallKind; label: string }[] = [
  { kind: "note", label: "Notes" },
  { kind: "recall", label: "Reads" },
  { kind: "promotion", label: "Promotions" },
  { kind: "directive", label: "Directives" },
  { kind: "approval", label: "Approvals" },
]

/** The folded graph: still live, as a column of counters. */
function CollapsedStrip() {
  const { setGraphView } = useTower()
  const calls = useVisibleCalls()
  return (
    <div className="flex h-full items-center gap-3 px-3 lg:flex-col lg:px-0 lg:py-3">
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Open the graph" onClick={() => setGraphView("panel")}>
        <Icon name="right_panel_open" size={20} />
      </Button>
      <div className="flex gap-3 lg:mt-2 lg:flex-col lg:gap-4">
        {STRIP.map(({ kind, label }) => (
          <div key={kind} className="text-center" title={label}>
            <div className="text-[15px] font-bold tabular-nums">{calls.filter((c) => c.kind === kind).length}</div>
            <div className="text-[11.5px] text-muted-foreground">{label.slice(0, 5)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
