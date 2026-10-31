"use client"

import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { agentColor, cap, clock, describe } from "@/lib/format"
import { DESIGN, EVENTS } from "@/lib/data"
import { useTower } from "./tower-store"

const HEIGHT: Record<string, number> = { write: 1, read: 0.6, handoff: 0.38 }

/**
 * The run as a strip of bars, one per Meko call, coloured by the agent that made it.
 * Problems are marked above their bar; click any bar to jump the graph and chat to that moment.
 */
export function ActivityStrip() {
  const { state, setReplay } = useTower()
  const flagged = new Set(state.issues.map((i) => i.evidence.at(-1)))
  const at = state.replayN

  return (
    <div className="shrink-0 border-t bg-card px-4 pt-3 pb-3">
      <div className="mb-2 flex items-center gap-3 text-[13px] text-muted-foreground">
        <span className="font-semibold text-ink-2">Activity</span>
        <span className="font-mono">{at ? clock(EVENTS[at - 1].ts, true) : "17:00:00"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {DESIGN.agents.map((a) => (
            <span key={a} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: agentColor(a) }} />
              {cap(a)}
            </span>
          ))}
        </div>
      </div>
      <div className="relative flex h-14 items-end gap-[3px]" role="group" aria-label="Meko calls in run-42, oldest first">
        {EVENTS.map((e, i) => {
          const done = i < at
          const current = i === at - 1
          return (
            <button
              key={e.event_id}
              type="button"
              onClick={() => setReplay(i + 1)}
              title={`${clock(e.ts, true)} · ${describe(e)}`}
              aria-label={`${clock(e.ts, true)}, ${describe(e)}`}
              className="group relative flex h-full flex-1 items-end"
            >
              {flagged.has(e.event_id) && done && <span className="absolute top-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[var(--ripple)]" />}
              <motion.span
                className={cn("w-full rounded-[3px] transition-opacity", !done && "opacity-15", current && "ring-2 ring-offset-1 ring-offset-card")}
                style={{ background: agentColor(e.agent), ["--tw-ring-color" as string]: agentColor(e.agent) }}
                initial={false}
                animate={{ height: `${(done ? HEIGHT[e.op] ?? 0.5 : 0.25) * 72}%` }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
              />
              <span className="absolute inset-x-0 -bottom-1 h-px bg-transparent group-hover:bg-ink-2/40" />
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[12px] text-muted-foreground">
        <span>17:00</span>
        <span>write · read · handoff by bar height</span>
        <span>17:09</span>
      </div>
    </div>
  )
}
