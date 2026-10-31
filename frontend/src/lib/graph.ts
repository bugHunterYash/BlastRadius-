import type { Issue, MemoryEvent, PriorVersion } from "./types"

export type LinkOp = "read" | "write" | "handoff"

export interface Link {
  key: string
  op: LinkOp
  source: string
  target: string
  /** index of the latest event folded into this link */
  last: number
  issue: Issue | null
}

export const linkKey = (e: MemoryEvent) =>
  e.op === "handoff" ? `handoff|${e.agent}|${e.target_agent}` : `${e.op}|${e.agent}|${e.fact_key}`

export const isOpen = (i: Issue) => i.status === "open" || i.status === "fix_ready"

/** Fold the first `upTo` events into one link per (op, agent, fact). Reads point fact → agent. */
export function buildLinks(events: MemoryEvent[], issues: Issue[], upTo = events.length): Link[] {
  const links = new Map<string, Link>()
  events.slice(0, upTo).forEach((e, i) => {
    if (e.op !== "read" && e.op !== "write" && e.op !== "handoff") return
    const key = linkKey(e)
    let link = links.get(key)
    if (!link) {
      const source = e.op === "read" ? e.fact_key! : e.agent
      const target = e.op === "handoff" ? e.target_agent! : e.op === "write" ? e.fact_key! : e.agent
      link = { key, op: e.op, source, target, last: i, issue: null }
      links.set(key, link)
    }
    link.last = i
    const offending = issues.find((iss) => iss.evidence.at(-1) === e.event_id)
    if (offending) link.issue = offending
  })
  return [...links.values()]
}

export interface TraceStep {
  hop: number
  node: string
  event: MemoryEvent
}

export interface Trace {
  root: MemoryEvent
  hops: Map<string, number>
  links: Set<string>
  steps: TraceStep[]
}

/**
 * Blast radius, as the guide describes GET /v1/blast-radius: from one write, find every later read
 * of that version, then every output those agents wrote afterwards, up to five hops.
 */
export function traceFrom(events: MemoryEvent[], eventId: string): Trace | null {
  const root = events.find((e) => e.event_id === eventId)
  if (!root || root.op !== "write" || !root.fact_key) return null
  const index = (e: MemoryEvent) => events.indexOf(e)
  const hops = new Map<string, number>([[root.fact_key, 0]])
  const links = new Set<string>([linkKey(root)])
  const steps: TraceStep[] = [{ hop: 0, node: root.fact_key, event: root }]

  let frontier = [{ fact: root.fact_key, version: root.version, at: index(root) }]
  let hop = 0
  while (frontier.length && hop < 5) {
    const next: typeof frontier = []
    for (const f of frontier) {
      for (const read of events.filter((e) => e.op === "read" && e.fact_key === f.fact && e.version === f.version && index(e) > f.at)) {
        links.add(linkKey(read))
        if (!hops.has(read.agent)) {
          hops.set(read.agent, hop + 1)
          steps.push({ hop: hop + 1, node: read.agent, event: read })
        }
        for (const write of events.filter((e) => e.op === "write" && e.agent === read.agent && index(e) > index(read))) {
          links.add(linkKey(write))
          if (!hops.has(write.fact_key!)) {
            hops.set(write.fact_key!, hop + 2)
            steps.push({ hop: hop + 2, node: write.fact_key!, event: write })
            next.push({ fact: write.fact_key!, version: write.version, at: index(write) })
          }
        }
      }
    }
    frontier = next
    hop += 2
  }
  steps.sort((a, b) => a.hop - b.hop || index(a.event) - index(b.event))
  return { root, hops, links, steps }
}

/** Latest version of a fact among the first `upTo` events, falling back to what existed before the run. */
export function latestVersion(fact: string, events: MemoryEvent[], prior: PriorVersion[], upTo = events.length) {
  let found: { version: number; value: string; agent: string; ts: string } | null = null
  const p = prior.find((x) => x.fact_key === fact)
  if (p) found = { version: p.version, value: p.value_preview, agent: p.agent, ts: p.ts }
  for (const e of events.slice(0, upTo)) {
    if (e.op === "write" && e.fact_key === fact) found = { version: e.version!, value: e.value_preview ?? "", agent: e.agent, ts: e.ts }
  }
  return found
}
