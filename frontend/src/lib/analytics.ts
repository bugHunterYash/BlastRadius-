import { isOpen, latestVersion, traceFrom } from "./graph"
import type { Project } from "./sample-data"
import type { Issue, MekoCall, MemoryEvent, PriorVersion } from "./types"

/** Everything the session report shows, worked out from the run's own events, issues and calls. */
export interface SessionReport {
  durationSec: number
  startTs: string
  endTs: string
  totals: { calls: number; writes: number; reads: number; handoffs: number; facts: number; versions: number }
  /** share of reads that returned an older version than the newest one at that moment */
  staleRate: number
  staleReads: MemoryEvent[]
  issues: { found: number; fixed: number; dismissed: number; open: number }
  /** 0–100: clean calls, minus a penalty for every issue still open */
  health: number
  phases: { id: string; label: string; agent: string; start: number; end: number; calls: number; issues: number; done: boolean }[]
  agents: { agent: string; writes: number; reads: number; handoffs: number; issues: number; health: number }[]
  facts: { fact: string; versions: number; readers: { agent: string; version: number; stale: boolean }[] }[]
  /** did a bad value make it into the final deliverable? */
  shippedWithIssue: boolean
  lessons: MekoCall[]
  headline: string
  verdict: "clean" | "shipped-with-issues" | "blocked"
  charts: {
    /** calls per 30-second window, one key per agent */
    activity: Record<string, string | number>[]
    /** team health after each call, with the calls that raised an issue marked */
    health: { step: number; time: string; health: number; issue: number | null }[]
    /** reads per agent that got the newest version vs an outdated one */
    freshness: { agent: string; fresh: number; stale: number }[]
    /** seconds each phase was active */
    phaseTime: { phase: string; agent: string; seconds: number }[]
    /** running total of calls, for the KPI sparkline */
    cumulative: { step: number; calls: number }[]
  }
}

const clockAt = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

const sec = (ts: string) => {
  const [h, m, s] = ts.slice(11, 19).split(":").map(Number)
  return h * 3600 + m * 60 + s
}

export function buildReport(project: Project, events: MemoryEvent[], issues: Issue[], calls: MekoCall[], prior: PriorVersion[]): SessionReport {
  // a run with no memory events yet (e.g. only agent questions) still gets a report, with zeros
  const now = { ts: new Date().toISOString() }
  const start = events[0] ?? now
  const end = events.at(-1) ?? start
  const t0 = sec(start.ts)
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
    return {
      ...p,
      start: mine.length ? sec(mine[0].ts) - t0 : 0,
      end: mine.length ? sec(mine.at(-1)!.ts) - t0 : 0,
      calls: mine.length,
      issues: issues.filter((i) => i.agent === p.agent).length,
      done: mine.some((e) => e.op === "write" || e.op === "handoff"),
    }
  })

  const agents = project.phases.map(({ agent }) => {
    const mine = events.filter((e) => e.agent === agent)
    const bad = mine.filter((e) => offending.has(e.event_id)).length
    return {
      agent,
      writes: mine.filter((e) => e.op === "write").length,
      reads: mine.filter((e) => e.op === "read").length,
      handoffs: mine.filter((e) => e.op === "handoff").length,
      issues: issues.filter((i) => i.agent === agent).length,
      health: mine.length ? Math.round(((mine.length - bad) / mine.length) * 100) : 100,
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

  const durationSec = Math.max(0, sec(end.ts) - t0)
  const mins = Math.floor(durationSec / 60)
  const verdict: SessionReport["verdict"] = openIssues.length === 0 && !shippedWithIssue ? "clean" : shippedWithIssue ? "shipped-with-issues" : "blocked"
  const headline =
    verdict === "clean"
      ? `Your ${agents.length} agents delivered the ${project.deliverable} in ${mins}m ${durationSec % 60}s with no coordination problems.`
      : `Your ${agents.length} agents delivered the ${project.deliverable} in ${mins}m ${durationSec % 60}s, but ${issues.length} coordination ${issues.length === 1 ? "problem" : "problems"} came up${shippedWithIssue ? " and an outdated value made it into the final " + project.deliverable : ""}.`

  // ---- chart series ----
  const BIN = 30
  const bins = Math.floor(durationSec / BIN) + 1
  const activity = Array.from({ length: bins }, (_, b) => {
    const row: Record<string, string | number> = { time: clockAt(t0 + b * BIN) }
    for (const p of project.phases) row[p.agent] = 0
    return row
  })
  for (const e of events) {
    const row = activity[Math.floor((sec(e.ts) - t0) / BIN)]
    if (row && e.agent in row) row[e.agent] = (row[e.agent] as number) + 1
  }

  let cleanSoFar = 0
  const healthSeries = events.map((e, i) => {
    const bad = offending.has(e.event_id)
    if (!bad) cleanSoFar++
    const value = Math.round((cleanSoFar / (i + 1)) * 100)
    return { step: i + 1, time: e.ts.slice(11, 19), health: value, issue: bad ? value : null }
  })

  const freshness = project.phases.map(({ agent }) => {
    const mine = reads.filter((r) => r.agent === agent)
    const stale = mine.filter((r) => staleReads.includes(r)).length
    return { agent, fresh: mine.length - stale, stale }
  })

  const phaseTime = phases.map((p) => ({ phase: p.label, agent: p.agent, seconds: Math.max(p.end - p.start, 1) }))
  const cumulative = events.map((_, i) => ({ step: i + 1, calls: i + 1 }))

  return {
    charts: { activity, health: healthSeries, freshness, phaseTime, cumulative },
    durationSec,
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
