// Shapes follow the backend integration guide (POST /v1/events, GET /v1/issues/{id}, design.json),
// so the sample data can be swapped for API responses without touching the components.

export type Op = "run_start" | "run_end" | "read" | "write" | "handoff"

export interface MemoryEvent {
  event_id: string
  run_id: string
  agent: string
  op: Op
  fact_key?: string
  version?: number
  value_preview?: string
  target_agent?: string
  ts: string
}

export type IssueType = "stale_read" | "conflict" | "skipped_handoff" | "permission_leak"
export type IssueStatus = "open" | "fix_ready" | "approved" | "rejected" | "resolved"
export type FixType = "prompt" | "permission" | "handoff_rule" | "routing"

export interface Fix {
  fix_id: string
  explanation: string
  fix_type: FixType
  target_agent: string
  before: string
  after: string
  risk: "low" | "medium" | "high"
  verify_by: string
}

export interface Issue {
  issue_id: string
  run_id: string
  type: IssueType
  agent: string
  fact_key: string | null
  /** event_ids that prove the issue; the last one is the offending event */
  evidence: string[]
  status: IssueStatus
  /** one-line headline and a short paragraph for people, written by the Summarizer */
  headline: string
  story: string
  fix: Fix | null
}

export interface AgentPermissions {
  read: string[]
  write: string[]
}

export interface DesignSpec {
  agents: string[]
  handoffs: [string, string][]
  must_pass_through: Record<string, string[]>
  permissions: Record<string, AgentPermissions>
}

export interface Run {
  run_id: string
  datapack: string
  status: "running" | "analysing" | "done"
  started_at: string
  headline: string
  summary: string
}

/**
 * One logged Meko call, as the swarm view shows it: a note written into a datapack, a recall,
 * a directive from one agent to another, a promotion to shared knowledge, or a person's approval.
 */
export type CallKind = "note" | "recall" | "directive" | "promotion" | "approval" | "error"

export interface MekoCall {
  call_id: string
  ts: string
  /** an agent id, or "you" for the person using the tower */
  actor: string
  kind: CallKind
  datapack: string
  /** recipient for directives */
  to?: string
  /** what was said, as it appears in the shared chat */
  text: string
  /** the memory event this call produced, when there is one */
  event_id?: string
}

/** A value saved before the run started (the backend's prior_versions). */
export interface PriorVersion {
  fact_key: string
  version: number
  value_preview: string
  agent: string
  ts: string
}
