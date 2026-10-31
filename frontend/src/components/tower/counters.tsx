"use client"

import { cn } from "@/lib/utils"
import type { CallKind } from "@/lib/types"
import { useVisibleCalls } from "./shared-chat"

// each kind of Meko call has its own colour, matching the verbs in the chat
const TINT: Record<CallKind, string> = {
  note: "var(--primary)",
  recall: "var(--agent-researcher)",
  promotion: "var(--agent-writer)",
  directive: "var(--agent-reviewer)",
  approval: "var(--agent-publisher)",
  error: "var(--destructive)",
}

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
            <span className={cn("text-[15px] font-bold tabular-nums", n === 0 && "opacity-40")} style={{ color: TINT[kind] }}>{n}</span>
            <span className="text-[13px] text-muted-foreground">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
