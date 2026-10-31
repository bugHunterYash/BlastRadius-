import type { FixType, IssueType, MemoryEvent } from "./types"

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "2026-10-31T17:04:03Z" → "17:04" (or "17:04:03" with seconds) */
export const clock = (ts: string, seconds = false) => ts.slice(11, seconds ? 19 : 16)

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
