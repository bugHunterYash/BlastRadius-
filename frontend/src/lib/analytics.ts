import { isOpen, latestVersion, traceFrom } from "./graph"
import type { RuntimeTask } from "./api"
import type { Project } from "./sample-data"
import type { Issue, MekoCall, MemoryEvent, PriorVersion } from "./types"

/** Everything the session report shows, worked out from the run's own events, issues and calls. */
export interface SessionReport {
  durationSec: number
  startTs: string
  endTs: string
  /** what the agents' runtimes did: tasks, answers, tokens, steps */
  runtime: {
    tasks: RuntimeTask[]
    done: number
    failed: number
    running: number
    inputTokens: number
    outputTokens: number
    tools: number
    commands: number
    files: number
    /** total seconds agents spent working (tasks can overlap) */
    busySec: number
  }
  totals: { calls: number; writes: number; reads: number; handoffs: number; facts: number; versions: number }
  /** share of reads that returned an older version than the newest one at that moment */
  staleRate: number
  staleReads: MemoryEvent[]
  issues: { found: number; fixed: number; dismissed: number; open: number }
  /** 0–100: clean calls, minus a penalty for every issue still open */
  health: number
  phases: { id: string; label: string; agent: string; start: number; end: number; calls: number; tasks: number; issues: number; done: boolean }[]
  agents: { agent: string; writes: number; reads: number; handoffs: number; issues: number; health: number; tasks: number; tasksDone: number; tokens: number; steps: number; busySec: number }[]
  facts: { fact: string; versions: number; readers: { agent: string; version: number; stale: boolean }[] }[]
  /** did a bad value make it into the final deliverable? */
  shippedWithIssue: boolean
  lessons: MekoCall[]
  headline: string
  verdict: "clean" | "shipped-with-issues" | "blocked"
  charts: {
    /** calls per time window (binSec long), one key per agent */
    activity: Record<string, string | number>[]
    /** team health after each call, with the calls that raised an issue marked */
    health: { step: number; time: string; health: number; issue: number | null }[]
    /** reads per agent that got the newest version vs an outdated one */
    freshness: { agent: string; fresh: number; stale: number }[]
    /** seconds each phase was active */
    phaseTime: { phase: string; agent: string; seconds: number }[]
    /** running total of calls, for the KPI sparkline */
    cumulative: { step: number; calls: number }[]
    binSec: number
  }
}

/** Epoch seconds as the viewer's local "HH:MM:SS". */
const clockAt = (s: number) => new Date(s * 1000).toLocaleTimeString("en-GB", { hour12: false })

/** Seconds since the epoch: real time, so a run that crosses midnight or a day still adds up. */
const sec = (ts: string) => Math.floor(new Date(ts).getTime() / 1000)
const iso = (s: number) => new Date(s * 1000).toISOString()
const TERMINAL = new Set(["completed", "failed", "cancelled", "timeout"])

export function buildReport(project: Project, events: MemoryEvent[], issues: Issue[], calls: MekoCall[], prior: PriorVersion[], tasks: RuntimeTask[] = []): SessionReport {
  // the run spans its memory events and its agents' tasks, whichever came first and last
  const taskEnd = (t: RuntimeTask) => sec(t.completed_at ?? (TERMINAL.has(t.status) ? t.created_at : new Date().toISOString()))
  const starts = [...events.map((e) => sec(e.ts)), ...tasks.map((t) => sec(t.created_at))]
  const ends = [...events.map((e) => sec(e.ts)), ...tasks.map(taskEnd)]
  const t0 = starts.length ? Math.min(...starts) : sec(new Date().toISOString())
  const t1 = ends.length ? Math.max(...ends) : t0
  const start = { ts: iso(t0) }
  const end = { ts: iso(t1) }
  const writes = events.filter((e) => e.op === "write")
  const reads = events.filter((e) => e.op === "read")
  const handoffs = events.filter((e) => e.op === "handoff")
  const facts = [...new Set(events.filter((e) => e.fact_key).map((e) => e.fact_key!))]

  // a read is stale when a newer version of that fact had already been written
  const staleReads = reads.filter((r) => {
    const upTo = events.indexOf(r)
    const newest = latestVersion(r.fact_key!, events, prior, upTo)
    return !!newest && r.version! < newest.version
  })

  const offending = new Set(issues.map((i) => i.evidence.at(-1)))
  const openIssues = issues.filter(isOpen)
  const fixed = issues.filter((i) => i.status === "approved" || i.status === "resolved").length
  const dismissed = issues.filter((i) => i.status === "rejected").length

  const clean = events.filter((e) => !offending.has(e.event_id)).length
  const health = events.length ? Math.max(0, Math.round((clean / events.length) * 100 - openIssues.length * 8)) : 100

  const phases = project.phases.map((p) => {
    const mine = events.filter((e) => e.agent === p.agent)
    const work = tasks.filter((t) => t.agent_id === p.agent)
    const from = [...mine.map((e) => sec(e.ts)), ...work.map((t) => sec(t.created_at))]
    const until = [...mine.map((e) => sec(e.ts)), ...work.map(taskEnd)]
    return {
      ...p,
      start: from.length ? Math.min(...from) - t0 : 0,
      end: until.length ? Math.max(...until) - t0 : 0,
      calls: mine.length,
      tasks: work.length,
      issues: issues.filter((i) => i.agent === p.agent).length,
      done: mine.some((e) => e.op === "write" || e.op === "handoff") || work.some((t) => t.status === "completed"),
    }
  })

  const busy = (t: RuntimeTask) => Math.max(0, taskEnd(t) - sec(t.started_at ?? t.created_at))
  const agentNames = [...new Set(project.phases.map((p) => p.agent))]
  const agents = agentNames.map((agent) => {
    const mine = events.filter((e) => e.agent === agent)
    const work = tasks.filter((t) => t.agent_id === agent)
    const bad = mine.filter((e) => offending.has(e.event_id)).length
    const failedWork = work.filter((t) => TERMINAL.has(t.status) && t.status !== "completed").length
    const units = mine.length + work.length
    return {
      agent,
      writes: mine.filter((e) => e.op === "write").length,
      reads: mine.filter((e) => e.op === "read").length,
      handoffs: mine.filter((e) => e.op === "handoff").length,
      issues: issues.filter((i) => i.agent === agent).length,
      health: units ? Math.round(((units - bad - failedWork) / units) * 100) : 100,
      tasks: work.length,
      tasksDone: work.filter((t) => t.status === "completed").length,
      tokens: work.reduce((n, t) => n + (t.input_tokens ?? 0) + (t.output_tokens ?? 0), 0),
      steps: work.reduce((n, t) => n + t.tools + t.commands + t.files, 0),
      busySec: work.reduce((n, t) => n + busy(t), 0),
    }
  })

  const factRows = facts.map((fact) => ({
    fact,
    versions: writes.filter((w) => w.fact_key === fact).length,
    readers: reads
      .filter((r) => r.fact_key === fact)
      .map((r) => ({ agent: r.agent, version: r.version!, stale: staleReads.includes(r) })),
  }))

  // follow every superseded write: if its value reached the last output, the deliverable shipped with it
  const lastOutput = writes.at(-1)?.fact_key
  const superseded = writes.filter((w) => writes.some((n) => n.fact_key === w.fact_key && n.version! > w.version!))
  const shippedWithIssue = superseded.some((w) => !!lastOutput && traceFrom(events, w.event_id)?.hops.has(lastOutput))

  const durationSec = Math.max(0, t1 - t0)
  const done = tasks.filter((t) => t.status === "completed").length
  const failed = tasks.filter((t) => TERMINAL.has(t.status) && t.status !== "completed").length
  const running = tasks.length - done - failed
  const verdict: SessionReport["verdict"] = shippedWithIssue ? "shipped-with-issues" : openIssues.length || failed || running ? "blocked" : "clean"
  const active = agents.filter((a) => a.tasks || a.writes + a.reads + a.handoffs).length
  const took = fmtSpan(durationSec)
  const work = [
    tasks.length ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` : "",
    events.length ? `${events.length} memory ${events.length === 1 ? "call" : "calls"}` : "",
  ].filter(Boolean).join(" and ")
  const problems = issues.length ? `${issues.length} coordination ${issues.length === 1 ? "problem" : "problems"} (${openIssues.length} still open)` : "no coordination problems"
  const notes = [
    failed ? `${failed} ${failed === 1 ? "task" : "tasks"} failed` : "",
    running ? `${running} still running` : "",
    issues.length ? problems : "",
    shippedWithIssue ? `an outdated value reached the final ${project.deliverable}` : "",
  ].filter(Boolean).join(", ")
  const headline = !work
    ? "Nothing has happened in this run yet."
    : verdict === "clean"
      ? `${active} ${active === 1 ? "agent" : "agents"} finished the ${project.deliverable} in ${took}: ${work}, every task done and ${problems}.`
      : `${active} ${active === 1 ? "agent" : "agents"} worked on the ${project.deliverable} for ${took}: ${work}. ${notes.charAt(0).toUpperCase()}${notes.slice(1)}.`

  // ---- chart series ----
  // about 40 windows over the run, never under 30 seconds each
  const BIN = Math.max(30, Math.ceil(durationSec / 40 / 30) * 30)
  const bins = Math.floor(durationSec / BIN) + 1
  const activity = Array.from({ length: bins }, (_, b) => {
    const row: Record<string, string | number> = { time: clockAt(t0 + b * BIN) }
    for (const a of agentNames) row[a] = 0
    return row
  })
  for (const e of events) {
    const row = activity[Math.floor((sec(e.ts) - t0) / BIN)]
    if (row && e.agent in row) row[e.agent] = (row[e.agent] as number) + 1
  }
  // a task counts once, plus each tool call, command and file change it made
  for (const t of tasks) {
    const row = activity[Math.floor((sec(t.created_at) - t0) / BIN)]
    if (row && t.agent_id in row) row[t.agent_id] = (row[t.agent_id] as number) + 1 + t.tools + t.commands + t.files
  }

  let cleanSoFar = 0
  const healthSeries = events.map((e, i) => {
    const bad = offending.has(e.event_id)
    if (!bad) cleanSoFar++
    const value = Math.round((cleanSoFar / (i + 1)) * 100)
    return { step: i + 1, time: new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false }), health: value, issue: bad ? value : null }
  })

  const freshness = agentNames.map((agent) => {
    const mine = reads.filter((r) => r.agent === agent)
    const stale = mine.filter((r) => staleReads.includes(r)).length
    return { agent, fresh: mine.length - stale, stale }
  })

  const phaseTime = phases.map((p) => ({ phase: p.label, agent: p.agent, seconds: Math.max(p.end - p.start, 1) }))
  const cumulative = events.map((_, i) => ({ step: i + 1, calls: i + 1 }))

  return {
    charts: { activity, health: healthSeries, freshness, phaseTime, cumulative, binSec: BIN },
    durationSec,
    runtime: {
      tasks,
      done,
      failed,
      running,
      inputTokens: tasks.reduce((n, t) => n + (t.input_tokens ?? 0), 0),
      outputTokens: tasks.reduce((n, t) => n + (t.output_tokens ?? 0), 0),
      tools: tasks.reduce((n, t) => n + t.tools, 0),
      commands: tasks.reduce((n, t) => n + t.commands, 0),
      files: tasks.reduce((n, t) => n + t.files, 0),
      busySec: tasks.reduce((n, t) => n + busy(t), 0),
    },
    startTs: start.ts,
    endTs: end.ts,
    // memory calls only: runtime steps (tool calls, commands) are in the chat too, but aren't Meko calls
    totals: { calls: calls.filter((c) => !c.exec).length, writes: writes.length, reads: reads.length, handoffs: handoffs.length, facts: facts.length, versions: writes.length },
    staleRate: reads.length ? staleReads.length / reads.length : 0,
    staleReads,
    issues: { found: issues.length, fixed, dismissed, open: openIssues.length },
    health,
    phases,
    agents,
    facts: factRows,
    shippedWithIssue,
    lessons: calls.filter((c) => c.kind === "promotion"),
    headline,
    verdict,
  }
}

/** 75 -> "1m 15s", 5400 -> "1h 30m", three days -> "3d 2h". */
export function fmtSpan(s: number) {
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}
