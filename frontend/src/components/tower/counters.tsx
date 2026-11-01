"use client"

import { cn } from "@/lib/utils"
import type { CallKind } from "@/lib/types"
import { useVisibleCalls } from "./shared-chat"

// each kind of Meko call has its own colour, matching the verbs in the chat
const TINT: Partial<Record<CallKind, string>> = {
  note: "var(--primary)",
  recall: "var(--agent-researcher)",
  promotion: "var(--agent-writer)",
  directive: "var(--agent-reviewer)",
  approval: "var(--agent-publisher)",
  error: "var(--destructive)",
  tool: "var(--ink-2)",
  command: "var(--ink-2)",
}

const ORDER: { kind: CallKind; label: string }[] = [
  { kind: "note", label: "notes" },
  { kind: "recall", label: "reads" },
  { kind: "promotion", label: "promotions" },
  { kind: "directive", label: "directives" },
  { kind: "approval", label: "approvals" },
  { kind: "tool", label: "tool calls" },
  { kind: "command", label: "commands" },
  { kind: "error", label: "errors" },
]

/** Running totals of Meko calls: one row above the graph (scrolls sideways when narrow), never on top of it. */
export function Counters() {
  const calls = useVisibleCalls()
  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-4 py-2 [scrollbar-width:none]">
      {ORDER.map(({ kind, label }) => {
        const n = calls.filter((c) => c.kind === kind).length
        return (
          <div key={kind} className="flex h-7 shrink-0 items-baseline gap-1.5 whitespace-nowrap rounded-lg border bg-card px-2.5 pt-[5px]">
            <span className={cn("text-[15px] font-bold tabular-nums", n === 0 && "opacity-40")} style={{ color: TINT[kind] }}>{n}</span>
            <span className="text-[13px] text-muted-foreground">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
