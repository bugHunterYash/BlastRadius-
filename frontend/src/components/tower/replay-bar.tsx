"use client"

import { Pause, Play } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { clock, describe } from "@/lib/format"
import { EVENTS } from "@/lib/sample-data"
import { useTower } from "./tower-store"

export function ReplayBar() {
  const { state, setReplay, setPlaying } = useTower()
  const flagged = new Set(state.issues.map((i) => i.evidence.at(-1)))
  const current = EVENTS[state.replayN - 1]

  return (
    <AnimatePresence>
      {state.mode === "replay" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-x-4 bottom-4 z-10 flex items-center gap-4 rounded-xl border bg-card py-2 pr-4 pl-2 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.18)] sm:inset-x-5"
        >
          <Button size="icon" className="size-8 shrink-0 rounded-lg bg-foreground text-background hover:bg-foreground/90" aria-label={state.playing ? "Pause" : "Play"} onClick={() => setPlaying(!state.playing)}>
            {state.playing ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
          </Button>
          <div className="relative min-w-0 flex-1 pt-2">
            <div className="pointer-events-none absolute inset-x-[7px] top-0 h-1.5">
              {EVENTS.map((e, i) => (
                <span
                  key={e.event_id}
                  className={flagged.has(e.event_id) ? "absolute size-1.5 -translate-x-1/2 rounded-full bg-flag" : "absolute top-px size-1 -translate-x-1/2 rounded-full bg-border"}
                  style={{ left: `${((i + 1) / EVENTS.length) * 100}%` }}
                />
              ))}
            </div>
            <Slider value={[state.replayN]} min={0} max={EVENTS.length} step={1} onValueChange={([v]) => setReplay(v)} aria-label="Replay position" />
          </div>
          <div className="hidden w-56 shrink-0 truncate text-[13px] text-ink-2 md:block">
            <span className="mr-2 font-mono text-xs text-muted-foreground">{current ? clock(current.ts) : "17:00"}</span>
            {current ? describe(current) : "The run begins"}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Legend() {
  const { state } = useTower()
  if (state.mode === "replay") return null
  const items = [
    { label: "Write", style: "border-cobalt/70" },
    { label: "Read", style: "border-cobalt/30" },
    { label: "Handoff", style: "border-dashed border-muted-foreground" },
    { label: "Needs review", style: "border-flag" },
  ]
  return (
    <div className="pointer-events-none absolute bottom-4 left-5 z-10 hidden gap-5 text-xs text-muted-foreground md:flex">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-2">
          <span className={`w-[18px] border-t-[1.5px] ${it.style}`} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
