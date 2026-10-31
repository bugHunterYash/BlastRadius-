"use client"

import { Icon } from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isOpen, latestVersion } from "@/lib/graph"
import { cap, clock, FIX_LABEL, ISSUE_LABEL } from "@/lib/format"
import { AGENT_ROLES, DESIGN, EVENTS, PRIOR, RUNS } from "@/lib/sample-data"
import type { Issue } from "@/lib/types"
import { seenIssues, useTower } from "./tower-store"
import { Figures, IssueCard, Kicker, Meta, Note, Para, Row, Rows, Section, StatusPill, Timeline, Title } from "./ui-bits"

const byId = (id: string) => EVENTS.find((e) => e.event_id === id)!
const ordered = (ids: string[]) => ids.map(byId).sort((a, b) => EVENTS.indexOf(a) - EVENTS.indexOf(b))
const offending = (i: Issue) => i.evidence.at(-1)!

export function RunView({ id }: { id: string }) {
  const { state, go, trace, setMode } = useTower()
  const run = RUNS.find((r) => r.run_id === id)!
  const open = seenIssues(state).filter(isOpen)

  if (id !== "run-42") {
    return (
      <>
        <header>
          <Kicker>Today, {clock(run.started_at)}</Kicker>
          <Title>{run.headline}</Title>
          <Para>{run.summary}</Para>
        </header>
        <Note>The graph shows run-42 in this preview.</Note>
      </>
    )
  }

  return (
    <>
      <header>
        <Kicker>Today, {clock(run.started_at)} · {run.datapack}</Kicker>
        <Title>{run.headline}</Title>
        <Para>{run.summary}</Para>
      </header>
      <Figures
        items={[
          { value: DESIGN.agents.length, label: "Agents" },
          { value: EVENTS.length, label: "Memory events" },
          { value: open.length, label: "Need review", flag: open.length > 0 },
        ]}
      />
      <Section title="Needs your review">
        {open.length ? (
          <div className="flex flex-col gap-2">
            {open.map((i) => (
              <IssueCard key={i.issue_id} issue={i} onOpen={() => go("issue", i.issue_id)} />
            ))}
          </div>
        ) : (
          <Note>Nothing left to review. Every fix is decided.</Note>
        )}
      </Section>
      <Section title="What happened">
        <Timeline events={["ev05", "ev06", "ev12", "ev15"].map(byId)} flagged={state.issues.map(offending)} />
      </Section>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" className="h-10 rounded-[10px] px-4" onClick={() => trace("ev02")}>
          Trace where ₹499 went
        </Button>
        <Button size="lg" variant="outline" className="h-10 rounded-[10px] px-4" onClick={() => setMode("replay")}>
          Replay the run
        </Button>
      </div>
    </>
  )
}

export function IssuesView() {
  const { state, go } = useTower()
  const open = seenIssues(state).filter(isOpen)
  const decided = seenIssues(state).filter((i) => !isOpen(i))
  return (
    <>
      <header>
        <Kicker>run-42</Kicker>
        <Title>Issues</Title>
        <Para>Rule checks read every memory event of the run. Claude drafts one fix for each issue, and nothing changes until you approve it.</Para>
      </header>
      <Section title="Open">
        {open.length ? (
          <div className="flex flex-col gap-2">
            {open.map((i) => (
              <IssueCard key={i.issue_id} issue={i} onOpen={() => go("issue", i.issue_id)} />
            ))}
          </div>
        ) : (
          <Note>None.</Note>
        )}
      </Section>
      {decided.length > 0 && (
        <Section title="Decided">
          <div className="flex flex-col gap-2">
            {decided.map((i) => (
              <IssueCard key={i.issue_id} issue={i} onOpen={() => go("issue", i.issue_id)} />
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

export function RunsView() {
  const { state, go } = useTower()
  const open = seenIssues(state).filter(isOpen).length
  return (
    <>
      <header>
        <Title>Runs</Title>
        <Para>Every run of the content team, newest first.</Para>
      </header>
      <Rows>
        {RUNS.map((r) => (
          <Row
            key={r.run_id}
            onClick={() => go("run", r.run_id)}
            trail={r.run_id === "run-42" ? <Meta flag={open > 0}>{open ? `${open} to review` : "Clear"}</Meta> : <Meta>{clock(r.started_at)}</Meta>}
          >
            {r.run_id}
          </Row>
        ))}
      </Rows>
    </>
  )
}

export function AgentView({ id }: { id: string }) {
  const { state, go } = useTower()
  const perms = DESIGN.permissions[id]
  const mine = EVENTS.filter((e) => e.agent === id && (e.op === "read" || e.op === "write"))
  const open = seenIssues(state).filter((i) => isOpen(i) && i.agent === id)
  const flagged = new Set(open.map(offending))
  return (
    <>
      <header>
        <Kicker>Agent</Kicker>
        <Title>{cap(id)}</Title>
        <Para>
          {AGENT_ROLES[id]} In run-42 it made {mine.length} memory {mine.length === 1 ? "call" : "calls"}
          {open.length > 0 && (
            <>
              , and <b className="font-semibold text-foreground">{open.length} {open.length === 1 ? "needs" : "need"} your review</b>
            </>
          )}
          .
        </Para>
      </header>
      <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[15px]">
        <dt className="text-muted-foreground">Can read</dt>
        <dd>{perms.read.join(", ")}</dd>
        <dt className="text-muted-foreground">Can write</dt>
        <dd>{perms.write.join(", ")}</dd>
      </dl>
      {open.length > 0 && (
        <Section title="Needs your review">
          <div className="flex flex-col gap-2">
            {open.map((i) => (
              <IssueCard key={i.issue_id} issue={i} onOpen={() => go("issue", i.issue_id)} />
            ))}
          </div>
        </Section>
      )}
      <Section title="Activity">
        <Rows>
          {mine.map((e) => (
            <Row
              key={e.event_id}
              onClick={() => go("fact", e.fact_key!)}
              lead={<Meta>{clock(e.ts)}</Meta>}
              trail={flagged.has(e.event_id) ? <span className="size-2 rounded-full bg-flag" /> : undefined}
            >
              {e.op === "write" ? "Saved" : "Read"} {e.fact_key} v{e.version}
            </Row>
          ))}
        </Rows>
      </Section>
    </>
  )
}

export function FactView({ id }: { id: string }) {
  const { state, go, trace } = useTower()
  const writes = EVENTS.filter((e) => e.op === "write" && e.fact_key === id)
  const prior = PRIOR.find((p) => p.fact_key === id)
  const reads = EVENTS.filter((e) => e.op === "read" && e.fact_key === id)
  const current = latestVersion(id, EVENTS, PRIOR)!
  return (
    <>
      <header>
        <Kicker>Fact · {id} · v{current.version}</Kicker>
        <Title>{current.value}</Title>
        <Para>
          Saved by {cap(current.agent)} at {clock(current.ts)}.
          {writes.length > 1 && ` This fact has ${writes.length} versions, and not every agent read the newest one.`}
        </Para>
      </header>
      <Section title="Versions">
        <Rows>
          {[...writes].reverse().map((w) => (
            <Row
              key={w.event_id}
              lead={<Meta>v{w.version}</Meta>}
              trail={
                <Button variant="outline" size="sm" className="rounded-lg" onClick={() => trace(w.event_id)}>
                  Trace
                </Button>
              }
            >
              {w.value_preview}
            </Row>
          ))}
          {!writes.length && prior && (
            <Row lead={<Meta>v{prior.version}</Meta>} trail={<Meta>Before this run</Meta>}>
              {prior.value_preview}
            </Row>
          )}
        </Rows>
      </Section>
      <Section title="Read by">
        {reads.length ? (
          <Rows>
            {reads.map((e) => {
              const issue = state.issues.find((i) => offending(i) === e.event_id)
              return (
                <Row
                  key={e.event_id}
                  onClick={() => (issue ? go("issue", issue.issue_id) : go("agent", e.agent))}
                  trail={<Meta flag={!!issue && isOpen(issue)}>{issue ? ISSUE_LABEL[issue.type] : `read v${e.version}`}</Meta>}
                >
                  {cap(e.agent)}
                </Row>
              )
            })}
          </Rows>
        ) : (
          <Note>No agent has read it yet.</Note>
        )}
      </Section>
    </>
  )
}

export function IssueView({ id }: { id: string }) {
  const { state, go, decide } = useTower()
  const issue = state.issues.find((i) => i.issue_id === id)!
  const fix = issue.fix
  return (
    <>
      <header>
        <Kicker>
          {ISSUE_LABEL[issue.type]}
          <StatusPill status={issue.status} />
        </Kicker>
        <Title>{issue.headline}</Title>
        <Para>{issue.story}</Para>
        <div className="mt-3 flex gap-3 text-[14.5px]">
          <button type="button" className="text-ink-2 underline decoration-border underline-offset-4 hover:text-foreground" onClick={() => go("agent", issue.agent)}>
            {cap(issue.agent)}
          </button>
          {issue.fact_key && (
            <button type="button" className="text-ink-2 underline decoration-border underline-offset-4 hover:text-foreground" onClick={() => go("fact", issue.fact_key!)}>
              {issue.fact_key}
            </button>
          )}
        </div>
      </header>
      <Section title="Evidence">
        <Timeline events={ordered(issue.evidence)} flagged={[offending(issue)]} seconds />
      </Section>
      <Section title="Suggested fix">
        {!fix ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-muted px-4 py-3.5 text-[15px] text-muted-foreground">
            <Icon name="auto_awesome" size={20} className="animate-pulse text-cobalt" />
            Claude is drafting a fix
          </div>
        ) : (
          <>
            <p className="text-[16px] leading-relaxed text-ink-2">{fix.explanation}</p>
            <div className="mt-3.5 overflow-hidden rounded-xl border text-[14.5px]">
              <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 px-4 py-3">
                <span className="text-muted-foreground">Before</span>
                <code className="font-mono text-muted-foreground line-through decoration-border">{fix.before}</code>
              </div>
              <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 border-t bg-mint/[0.06] px-4 py-3">
                <span className="text-muted-foreground">After</span>
                <code className="font-mono break-words text-foreground">{fix.after}</code>
              </div>
            </div>
            <Note>
              <span className="mt-3 block">
                {FIX_LABEL[fix.fix_type]} change in {fix.target_agent}.yaml · {fix.risk} risk. {fix.verify_by}
              </span>
            </Note>
          </>
        )}
      </Section>
      {fix && issue.status === "fix_ready" && (
        <div className="flex gap-2">
          <Button size="lg" className="h-10 rounded-[10px] px-5" onClick={() => decide(issue.issue_id, "approved")}>
            Approve fix
          </Button>
          <Button size="lg" variant="outline" className="h-10 rounded-[10px] px-5" onClick={() => decide(issue.issue_id, "rejected")}>
            Dismiss
          </Button>
        </div>
      )}
      {(issue.status === "approved" || issue.status === "rejected") && (
        <div className={cn("flex items-center gap-2.5 rounded-xl px-4 py-3.5 text-[15px]", issue.status === "approved" ? "bg-mint/10 text-mint" : "bg-muted text-ink-2")}>
          <span className={cn("size-2 rounded-full", issue.status === "approved" ? "bg-mint" : "bg-muted-foreground")} />
          {issue.status === "approved" ? `Approved. ${fix?.target_agent}.yaml is updated and the decision is saved to Meko.` : "Dismissed. Claude keeps it as an example."}
        </div>
      )}
    </>
  )
}

export function TraceView({ id }: { id: string }) {
  const { state, go, trace } = useTower()
  const t = state.trace
  if (!t || t.root.event_id !== id) return null
  const agents = t.steps.filter((s) => DESIGN.agents.includes(s.node)).length
  const outputs = t.steps.filter((s) => s.hop > 0 && !DESIGN.agents.includes(s.node)).length
  const hops = Math.max(...t.steps.map((s) => s.hop))
  return (
    <>
      <header>
        <Kicker>Trace · {t.root.fact_key} v{t.root.version}</Kicker>
        <Title>Where {t.root.value_preview} went</Title>
        <Para>
          {cap(t.root.agent)} saved this value at {clock(t.root.ts)}. It reached {agents} agents and {outputs} outputs
          {t.hops.has("published") ? (
            <>
              , ending in <b className="font-semibold text-foreground">the published post</b>.
            </>
          ) : (
            "."
          )}
        </Para>
      </header>
      <Figures
        items={[
          { value: agents, label: "Agents" },
          { value: outputs, label: "Outputs" },
          { value: hops, label: "Hops" },
        ]}
      />
      <Section title="Path">
        <Rows>
          {t.steps.map((s) => {
            const isAgent = DESIGN.agents.includes(s.node)
            return (
              <Row
                key={`${s.node}-${s.hop}`}
                onClick={() => go(isAgent ? "agent" : "fact", s.node)}
                lead={<span className="grid size-5 shrink-0 place-items-center rounded-full bg-cobalt-soft font-mono text-[12px] text-cobalt">{s.hop}</span>}
                trail={<Meta>{clock(s.event.ts)}</Meta>}
              >
                {s.hop === 0 ? `${s.node} v${s.event.version} is saved` : isAgent ? `${cap(s.node)} reads it` : `${s.node} is written from it`}
              </Row>
            )
          })}
        </Rows>
      </Section>
      <div>
        <Button size="lg" variant="outline" className="h-10 rounded-[10px] px-4" onClick={() => trace(id)}>
          Play again
        </Button>
      </div>
    </>
  )
}
