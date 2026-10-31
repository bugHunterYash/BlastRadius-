"use client"

import { cn } from "@/lib/utils"
import type { CallKind } from "@/lib/types"
import { useVisibleCalls } from "./shared-chat"

const ORDER: { kind: CallKind; label: string }[] = [
  { kind: "note", label: "notes" },
  { kind: "recall", label: "reads" },
  { kind: "promotion", label: "promotions" },
  { kind: "directive", label: "directives" },
  { kind: "approval", label: "approvals" },
  { kind: "error", label: "errors" },
]

/** Running totals of Meko calls, the swarm view's counter strip. */
export function Counters() {
  const calls = useVisibleCalls()
  return (
    <div className="pointer-events-none absolute top-4 left-4 z-10 flex flex-wrap gap-1.5 sm:left-5">
      {ORDER.map(({ kind, label }) => {
        const n = calls.filter((c) => c.kind === kind).length
        return (
          <div key={kind} className="flex h-8 items-baseline gap-1.5 rounded-lg border bg-card/90 px-2.5 pt-[7px] backdrop-blur-sm">
            <span className={cn("text-sm font-semibold tabular-nums", kind === "error" && n > 0 && "text-destructive", n === 0 && "text-muted-foreground")}>{n}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
