// The data every view reads. It starts as the bundled sample (run-42) and is replaced by the live
// backend's run as soon as it loads (see tower-store). The exports are ES live bindings: components
// keep importing EVENTS, RUNS, DESIGN… and see the new values on their next render.

import * as sample from "./sample-data"
import { cap } from "./format"
import type { DesignSpec, Issue, IssueType, MekoCall, MemoryEvent, PriorVersion, Run } from "./types"

export type Source = "sample" | "live"

export let SOURCE: Source = "sample"
export let RUN_ID = "run-42"
export let DATAPACK = "content-team"
export let DESIGN: DesignSpec = sample.DESIGN
export let EVENTS: MemoryEvent[] = sample.EVENTS
export let CALLS: MekoCall[] = sample.CALLS
export let ISSUES: Issue[] = sample.ISSUES
export let RUNS: Run[] = sample.RUNS
export let PRIOR: PriorVersion[] = sample.PRIOR
export let LAYOUT: Record<string, { x: number; y: number }> = sample.LAYOUT
export let AGENT_ROLES: Record<string, string> = sample.AGENT_ROLES
/** Sample-only: a fix that "arrives" a few seconds after load. Live fixes come over /v1/stream. */
export let LATE_FIX: typeof sample.LATE_FIX | null = sample.LATE_FIX
/** Which provider runs each agent (from GET /v1/agents), e.g. { writer: "claude" }. */
export let PROVIDERS: Record<string, string> = {}
/** Each agent's runtime and the model it actually ran on (from the run's invocations). */
export let AGENT_META: Record<string, { provider?: string; model?: string | null }> = {}
/** The Summarizer's digest for the run on screen. */
export let DIGEST: ApiDigest | null = null
/** The write to trace from the Overview's main button, and its value. */
export let HEADLINE_TRACE: { eventId: string; label: string } | null = { eventId: "ev02", label: "₹499" }

export const datapackOf = sample.datapackOf
export const FACTS = () => Object.keys(LAYOUT).filter((id) => !DESIGN.agents.includes(id))

/* ---------- backend shapes ---------- */

export interface ApiEvent {
  event_id: string
  run_id: string
  agent: string
  op: MemoryEvent["op"]
  fact_key: string | null
  version: number | null
  value_preview: string | null
  target_agent: string | null
  reason: string | null
  invocation_id: string | null
  ts: string
}

export interface ApiIssue {
  issue_id: string
  run_id: string
  type: IssueType
  agent: string
  fact_key: string | null
  evidence: string[]
  detail: string | null
  note: string | null
  status: Issue["status"]
  fix: (Issue["fix"] & { model: string }) | null
}

export interface ApiRun {
  run_id: string
  datapack: string
  scenario: string | null
  status: string
  started_at: string
  issues: number
  open_issues: number
  events: number
}

export interface ApiDigest {
  run_id: string
  model: string
  summary: { headline: string; by_agent: { agent: string; summary: string }[]; notable: string[]; execution_summary?: Record<string, unknown> }
}

export interface ApiAgentRoute {
  agent_id: string
  routable: boolean
  provider?: string
  runtime?: string
  model?: string | null
  reason?: string
}

export interface ApiInvocation {
  invocation_id: string
  agent_id: string
  provider: string
  runtime: string
  model: string | null
  status: string
  why: string | null
  created_at: string
  completed_at?: string | null
  session_id?: string | null
  error_message?: string | null
  /** present with ?full=true */
  user_prompt?: string | null
  final_response?: string | null
}

export interface ApiExecEvent {
  invocation_id: string
  sequence: number
  event_type: string
  why: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface Snapshot {
  runId: string
  runs: ApiRun[]
  events: ApiEvent[]
  issues: ApiIssue[]
  design: DesignSpec
  digests: ApiDigest[]
  agents: ApiAgentRoute[]
  invocations: ApiInvocation[]
  execEvents: ApiExecEvent[]
  chatInvocations: ApiInvocation[]
}

/** Calls made in the browser (notes, questions, answers) rather than read from a run's events. */
export const isChatCall = (c: MekoCall) => /^(live|task|ans)-/.test(c.call_id)

const TERMINAL = new Set(["completed", "failed", "cancelled", "timeout"])

/** Today's questions to agents and their answers, rebuilt from the database. */
export function toChatCalls(invs: ApiInvocation[]): MekoCall[] {
  return invs.flatMap((inv) => {
    const dp = datapackOf(inv.agent_id)
    const done = TERMINAL.has(inv.status)
    const failed = done && inv.status !== "completed"
    return [
      { call_id: `task-${inv.invocation_id}`, ts: inv.created_at, actor: "you", kind: "task" as const, datapack: dp, to: inv.agent_id,
        text: inv.user_prompt ?? "" },
      { call_id: `ans-${inv.invocation_id}`, ts: inv.completed_at ?? inv.created_at, actor: inv.agent_id,
        kind: failed ? ("error" as const) : ("answer" as const), datapack: dp,
        text: !done ? "…" : failed ? `${inv.status === "cancelled" ? "Cancelled" : "Failed"}: ${inv.error_message ?? "no details"}` : inv.final_response || "(no answer)" },
    ]
  })
}

/** The newest conversation per agent, so a follow-up continues it. */
export let CHAT_SESSIONS: Record<string, string> = {}

/* ---------- execution steps ---------- */

const short = (s: unknown, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** A tool's input in one line: the path or pattern it worked on, else its first argument. */
function toolTarget(input: unknown): string {
  if (!input || typeof input !== "object") return short(input, 90)
  const i = input as Record<string, unknown>
  for (const k of ["file_path", "path", "pattern", "command", "url", "query", "notebook_path"]) if (i[k]) return short(i[k], 90)
  const first = Object.values(i)[0]
  return first === undefined ? "" : short(first, 90)
}

/**
 * Turn one invocation's captured events into timeline steps: the task it was given, what it said,
 * each tool call and command with its result, file changes and the final answer. Starts and results
 * of the same tool call are folded into one step.
 */
export function toExecCalls(inv: ApiInvocation, events: ApiExecEvent[]): MekoCall[] {
  const out: MekoCall[] = []
  const open = new Map<string, MekoCall>()
  const dp = datapackOf(inv.agent_id)
  const step = (e: ApiExecEvent, kind: MekoCall["kind"], text: string, extra: Partial<MekoCall["exec"]> = {}, actor = inv.agent_id): MekoCall => ({
    call_id: `x-${inv.invocation_id}-${e.sequence}`, ts: e.created_at, actor, kind, datapack: dp, text,
    exec: { invocation_id: inv.invocation_id, why: e.why, ...extra },
  })
  for (const e of events) {
    const p = e.payload
    const id = String(p.tool_use_id ?? p.item_id ?? "")
    switch (e.event_type) {
      case "prompt.received":
        out.push({ ...step(e, "prompt", String(p.prompt ?? ""), {}, "tower"), to: inv.agent_id })
        break
      case "message.completed":
        if (short(p.text)) out.push(step(e, "thought", String(p.text)))
        break
      case "tool.started":
        if (p.tool === "Bash") break // shown as a command
        open.set(`t:${id}`, out[out.push(step(e, "tool", `${p.tool ?? "tool"} ${toolTarget(p.input)}`.trim(), { status: "running" })) - 1])
        break
      case "tool.completed": {
        const c = open.get(`t:${id}`)
        const failed = p.is_error === true || p.status === "failed" || p.status === "declined"
        if (c) c.exec = { ...c.exec!, status: failed ? "failed" : "ok", detail: short(p.output ?? p.result ?? p.error, 140) }
        break
      }
      case "command.started":
        open.set(`c:${id}`, out[out.push(step(e, "command", short(p.command, 200), { status: "running" })) - 1])
        break
      case "command.completed": {
        const c = open.get(`c:${id}`)
        const code = p.exit_code as number | undefined
        const failed = p.is_error === true || (code !== undefined && code !== null && code !== 0) || p.status === "failed"
        const detail = [code !== undefined && code !== null ? `exit ${code}` : "", short(p.output, 140)].filter(Boolean).join(" · ")
        if (c) c.exec = { ...c.exec!, status: failed ? "failed" : "ok", detail }
        else out.push(step(e, "command", short(p.command, 200), { status: failed ? "failed" : "ok", detail }))
        break
      }
      case "file.changed":
        out.push(step(e, "file", String(p.path ?? "a file"), { status: "ok", detail: String(p.kind ?? p.tool ?? "") }))
        break
      case "approval.requested":
        out.push(step(e, "tool", `asked to ${p.kind === "command" ? `run ${short(p.command, 80)}` : "change files"}`, { status: "running" }))
        break
      case "execution.error":
        out.push(step(e, "error", short(p.message ?? p.subtype ?? "error", 300)))
        break
      case "invocation.completed":
        out.push(step(e, "result", String(p.final_response ?? "(no answer)"), { status: "ok" }))
        break
      case "invocation.failed":
      case "invocation.cancelled":
        out.push(step(e, "result", `${e.event_type.endsWith("cancelled") ? "Cancelled" : "Failed"}: ${short(p.error, 300) || "no details"}`, { status: "failed" }))
        break
    }
  }
  for (const c of open.values()) if (c.exec?.status === "running") c.exec.status = undefined
  return out
}

/* ---------- adapters ---------- */

const undef = <T,>(v: T | null): T | undefined => (v === null ? undefined : v)

export function toEvent(e: ApiEvent): MemoryEvent {
  return {
    event_id: e.event_id, run_id: e.run_id, agent: e.agent, op: e.op, fact_key: undef(e.fact_key),
    version: undef(e.version), value_preview: undef(e.value_preview), target_agent: undef(e.target_agent), ts: e.ts,
  }
}

const HEADLINE: Record<IssueType, (i: ApiIssue) => string> = {
  stale_read: (i) => `${cap(i.agent)} used an old ${i.fact_key}`,
  conflict: (i) => `${cap(i.agent)} overwrote ${i.fact_key} without reading it`,
  skipped_handoff: (i) => `${cap(i.agent)} went ahead before its handoff`,
  permission_leak: (i) => `${cap(i.agent)} touched ${i.fact_key}, which it isn’t allowed to`,
}

export function toIssue(i: ApiIssue, events: ApiEvent[]): Issue {
  // The UI treats the last evidence id as the offending event. The skipped-handoff detector lists the
  // write first, so put it last; the others already end with the offending event.
  const order = new Map(events.map((e, n) => [e.event_id, n]))
  let evidence = [...i.evidence]
  if (i.type === "skipped_handoff") {
    const write = i.evidence[0]
    evidence = [...i.evidence.slice(1), write].sort((a, b) => (a === write ? 1 : b === write ? -1 : (order.get(a) ?? 0) - (order.get(b) ?? 0)))
  }
  return {
    issue_id: i.issue_id, run_id: i.run_id, type: i.type, agent: i.agent, fact_key: i.fact_key, evidence,
    status: i.status, headline: HEADLINE[i.type](i),
    story: [i.detail, i.note].filter(Boolean).join(" "),
    fix: i.fix ? { fix_id: i.fix.fix_id, explanation: i.fix.explanation, fix_type: i.fix.fix_type, target_agent: i.fix.target_agent,
                   before: i.fix.before, after: i.fix.after, risk: i.fix.risk, verify_by: i.fix.verify_by } : null,
  }
}

/** What the agent "said" in the shared chat: its own reason when it gave one, otherwise the plain action. */
function said(e: ApiEvent): string {
  if (e.reason) return e.reason
  if (e.op === "write") return `Saved ${e.fact_key} v${e.version}${e.value_preview ? `: ${e.value_preview}` : ""}`
  if (e.op === "read") return `Recalled ${e.fact_key} v${e.version}.`
  if (e.op === "handoff") return `Over to ${cap(e.target_agent ?? "")}.`
  return e.op.replace("_", " ")
}

export function toCall(e: ApiEvent): MekoCall {
  return {
    call_id: `c-${e.event_id}`, ts: e.ts, actor: e.agent,
    kind: e.op === "write" ? "note" : e.op === "read" ? "recall" : "directive",
    datapack: datapackOf(e.op === "handoff" ? e.target_agent ?? e.agent : e.agent),
    to: undef(e.target_agent), text: said(e), event_id: e.event_id,
  }
}

function toRun(r: ApiRun, digest?: ApiDigest): Run {
  const d = digest?.summary
  // the full per-agent digest sits at the end of the timeline; the header keeps to the facts
  const summary = `${r.events} memory events${r.issues ? `, ${r.issues} issue${r.issues > 1 ? "s" : ""}` : ", no issues"}.`
  return {
    run_id: r.run_id, datapack: r.datapack, status: r.status === "running" || r.status === "analysing" ? r.status : "done",
    started_at: r.started_at,
    headline: d?.headline ?? (r.status === "running" ? "Run in progress" : r.open_issues ? `${r.open_issues} issue${r.open_issues > 1 ? "s" : ""} to review` : "A clean run"),
    summary,
  }
}

/** Agents on a gentle zig-zag across the middle; each fact near the first agent that wrote (or read) it. */
export function layoutFor(design: DesignSpec, events: MemoryEvent[]): Record<string, { x: number; y: number }> {
  const agents = [...design.agents, ...new Set(events.map((e) => e.agent).filter((a) => a !== "system" && !design.agents.includes(a)))]
  const out: Record<string, { x: number; y: number }> = {}
  const n = agents.length
  agents.forEach((a, i) => {
    out[a] = { x: n === 1 ? 0.5 : 0.13 + (0.75 * i) / (n - 1), y: i % 2 ? 0.38 : 0.52 }
  })
  const owner = new Map<string, string>()
  for (const e of events) if (e.fact_key && !owner.has(e.fact_key) && e.op === "write") owner.set(e.fact_key, e.agent)
  for (const e of events) if (e.fact_key && !owner.has(e.fact_key)) owner.set(e.fact_key, e.agent)
  for (const [agent, perms] of Object.entries(design.permissions)) for (const f of perms.write) if (!owner.has(f)) owner.set(f, agent)
  const perAgent = new Map<string, number>()
  for (const [fact, agent] of owner) {
    const k = perAgent.get(agent) ?? 0
    perAgent.set(agent, k + 1)
    const base = out[agent] ?? { x: 0.5, y: 0.5 }
    const below = (agents.indexOf(agent) + k) % 2 === 0
    out[fact] = { x: Math.min(0.96, Math.max(0.04, base.x + (k % 2 ? 0.09 : -0.05) * (k + 1) * 0.6)), y: below ? 0.88 - 0.04 * k : 0.08 + 0.04 * k }
  }
  return out
}

/** Swap in a live run. Returns the initial issues and calls for the store. */
export function applySnapshot(s: Snapshot) {
  const events = s.events.filter((e) => e.op !== "run_start" && e.op !== "run_end")
  // digests arrive newest first; a run that was re-analysed has several, and the newest one counts
  const digestOf = new Map<string, ApiDigest>()
  for (const d of s.digests) if (!digestOf.has(d.run_id)) digestOf.set(d.run_id, d)
  SOURCE = "live"
  RUN_ID = s.runId
  DATAPACK = s.runs.find((r) => r.run_id === s.runId)?.datapack ?? DATAPACK
  DESIGN = { ...s.design, must_pass_through: s.design.must_pass_through ?? {}, permissions: s.design.permissions ?? {} }
  for (const a of DESIGN.agents) DESIGN.permissions[a] ??= { read: [], write: [] }
  EVENTS = events.map(toEvent)
  // memory calls and runtime steps, interleaved in the exact order they happened
  const byInv = new Map<string, ApiExecEvent[]>()
  for (const e of s.execEvents) byInv.set(e.invocation_id, [...(byInv.get(e.invocation_id) ?? []), e])
  const execCalls = s.invocations.flatMap((inv) => toExecCalls(inv, (byInv.get(inv.invocation_id) ?? []).sort((a, b) => a.sequence - b.sequence)))
  CALLS = [...events.map(toCall), ...execCalls, ...toChatCalls(s.chatInvocations)]
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  CHAT_SESSIONS = {}
  for (const inv of s.chatInvocations) if (inv.session_id && inv.status === "completed") CHAT_SESSIONS[inv.agent_id] = inv.session_id
  AGENT_META = {}
  for (const a of s.agents) if (a.provider) AGENT_META[a.agent_id] = { provider: a.provider, model: a.model }
  for (const inv of s.invocations) {
    const started = s.execEvents.find((e) => e.invocation_id === inv.invocation_id && e.event_type === "session.started")
    const model = (started?.payload.model as string | undefined) ?? inv.model
    AGENT_META[inv.agent_id] = { provider: inv.provider, model: model ?? AGENT_META[inv.agent_id]?.model }
  }
  DIGEST = s.digests.find((d) => d.run_id === s.runId) ?? null
  ISSUES = s.issues.map((i) => toIssue(i, events))
  RUNS = s.runs.map((r) => toRun(r, digestOf.get(r.run_id)))
  PRIOR = []
  LAYOUT = layoutFor(DESIGN, EVENTS)
  PROVIDERS = Object.fromEntries(s.agents.filter((a) => a.provider).map((a) => [a.agent_id, a.provider!]))
  AGENT_ROLES = Object.fromEntries(DESIGN.agents.map((a) => [a, PROVIDERS[a] ? `Runs on ${cap(PROVIDERS[a])}.` : ""]))
  LATE_FIX = null
  // the main "trace" button follows the value behind the first open issue, else the first write
  const first = ISSUES.find((i) => i.status === "open" || i.status === "fix_ready")
  const traceRoot =
    (first && EVENTS.find((e) => e.op === "write" && e.fact_key === first.fact_key)) || EVENTS.find((e) => e.op === "write")
  HEADLINE_TRACE = traceRoot ? { eventId: traceRoot.event_id, label: traceRoot.value_preview || `${traceRoot.fact_key} v${traceRoot.version}` } : null
  return { issues: ISSUES, calls: CALLS }
}
