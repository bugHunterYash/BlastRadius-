import type { FixType, IssueType, MemoryEvent } from "./types"

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Each agent's colour, used for its node, its avatar and its bars in the activity strip. */
export const agentColor = (agent: string) => `var(--agent-${agent}, var(--cobalt))`

/** An ISO timestamp as the viewer's local time: "22:34" (or "22:34:03" with seconds). */
export const clock = (ts: string, seconds = false) => {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(11, seconds ? 19 : 16)
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false })
}

export const ISSUE_LABEL: Record<IssueType, string> = {
  stale_read: "Stale read",
  conflict: "Conflict",
  skipped_handoff: "Skipped handoff",
  permission_leak: "Permission leak",
}

/** Short tag drawn on the graph edge. */
export const ISSUE_TAG: Record<IssueType, string> = {
  stale_read: "Stale read",
  conflict: "Conflict",
  skipped_handoff: "Skipped review",
  permission_leak: "Not permitted",
}

export const FIX_LABEL: Record<FixType, string> = {
  prompt: "Prompt",
  permission: "Permission",
  handoff_rule: "Handoff rule",
  routing: "Routing",
}

export function describe(e: MemoryEvent) {
  if (e.op === "handoff") return `${cap(e.agent)} handed off to ${cap(e.target_agent ?? "")}`
  if (e.op === "write") return `${cap(e.agent)} saved ${e.fact_key} v${e.version}`
  if (e.op === "read") return `${cap(e.agent)} read ${e.fact_key} v${e.version}`
  return `${cap(e.agent)} ${e.op.replace("_", " ")}`
}
