"use client"

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ReactFlowProvider } from "@xyflow/react"
import { Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Waypoints } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { CallKind } from "@/lib/types"
import { Counters } from "./counters"
import { MemoryGraph } from "./memory-graph"
import { Legend, ReplayBar } from "./replay-bar"
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
        <main aria-label="Shared memory chat" className="h-[80vh] min-h-0 min-w-0 flex-1 lg:h-auto">
          <SharedChat />
        </main>
      )}

      {graphView === "panel" && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize graph panel"
          onPointerDown={startDrag}
          className="group relative hidden w-px shrink-0 cursor-col-resize bg-border lg:block"
        >
          <span className={cn("absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-foreground/15", dragging && "bg-foreground/20")} />
        </div>
      )}

      <section
        aria-label="Memory graph"
        className={cn(
          "flex min-h-0 shrink-0 flex-col border-t bg-card lg:border-t-0",
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
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Waypoints className="size-4 text-muted-foreground" />
        <span className="text-[13.5px] font-medium">Memory graph</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", state.playing ? "animate-pulse bg-flag" : "bg-mint")} />
          {state.mode === "trace" ? "Trace" : state.mode === "replay" ? "Replay" : state.playing ? "Live" : "Run ended"}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={full ? "Show the chat again" : "Expand the graph"} onClick={() => setGraphView(full ? "panel" : "full")}>
            {full ? <Minimize2 /> : <Maximize2 />}
          </Button>
          {!full && (
            <Button variant="ghost" size="icon-sm" className="hidden text-muted-foreground lg:inline-flex" aria-label="Fold the graph away" onClick={() => setGraphView("collapsed")}>
              <PanelRightClose />
            </Button>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <ReactFlowProvider>
          <MemoryGraph />
        </ReactFlowProvider>
        <Counters />
        <Legend />
        <ReplayBar />
      </div>
    </>
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
        <PanelRightOpen />
      </Button>
      <div className="flex gap-3 lg:mt-2 lg:flex-col lg:gap-4">
        {STRIP.map(({ kind, label }) => (
          <div key={kind} className="text-center" title={label}>
            <div className="text-sm font-semibold tabular-nums">{calls.filter((c) => c.kind === kind).length}</div>
            <div className="text-[10px] text-muted-foreground">{label.slice(0, 5)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
