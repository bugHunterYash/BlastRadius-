"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { buildReport, fmtSpan, type SessionReport } from "@/lib/analytics"
import { api, type ReportData, type RuntimeTask } from "@/lib/api"
import { isOpen } from "@/lib/graph"
import { agentColor, cap, clock, FIX_LABEL, ISSUE_LABEL } from "@/lib/format"
import { DIGEST, EVENTS, PRIOR, RUNS } from "@/lib/data"
import { PROJECT, PROJECT_TEMPLATES, type Project, type ProjectKind } from "@/lib/sample-data"
import { AgentGlyph } from "./agent-glyph"
import { ActivityChart, FreshnessChart, HealthChart, PhaseTimeChart, Sparkline } from "./report-charts"
import { RuntimeMark, RUNTIME_LABEL } from "./runtime-logo"
import { useTower } from "./tower-store"

const pct = (n: number) => `${Math.round(n * 100)}%`
const num = (n: number) => n.toLocaleString("en-IN")
const when = (ts: string) =>
  new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })

/** Status colours are reserved for state and always ship with an icon and a word. */
const VERDICT = {
  clean: { label: "Delivered clean", icon: "check_circle", className: "bg-primary/10 text-primary" },
  "shipped-with-issues": { label: "Delivered with issues", icon: "error", className: "bg-flag-soft text-flag" },
  blocked: { label: "Needs follow-up", icon: "pending", className: "bg-[var(--agent-reviewer)]/10 text-[var(--agent-reviewer)]" },
} as const

const ROLE_LABEL: Record<string, string> = { researcher: "Research", writer: "Draft", reviewer: "Review", publisher: "Publish", analyst: "Analysis" }
const STATUS: Record<string, { label: string; icon: string; className: string }> = {
  completed: { label: "Done", icon: "check_circle", className: "text-primary" },
  failed: { label: "Failed", icon: "cancel", className: "text-flag" },
  timeout: { label: "Timed out", icon: "timer_off", className: "text-flag" },
  cancelled: { label: "Cancelled", icon: "do_not_disturb_on", className: "text-muted-foreground" },
  running: { label: "Running", icon: "progress_activity", className: "text-[var(--agent-reviewer)]" },
  queued: { label: "Queued", icon: "schedule", className: "text-muted-foreground" },
}

/**
 * The project a run belongs to. A run started with "New project" has a brief; any other run is
 * described from what happened in it (its agents, in the order they started, and its first task).
 */
function projectFor(data: ReportData | null, runId: string): Project {
  if (!data) return PROJECT // the bundled sample run
  const b = data.brief
  const seen = [...EVENTS.map((e) => ({ agent: e.agent, ts: e.ts })), ...data.invocations.map((t) => ({ agent: t.agent_id, ts: t.created_at }))]
    .sort((x, y) => x.ts.localeCompare(y.ts))
    .map((x) => x.agent)
  const order = [...new Set(seen)]
  if (b) {
    const listed = new Set(b.phases.map((p) => p.agent))
    const extra = order.filter((a) => !listed.has(a)).map((a) => ({ id: a, label: ROLE_LABEL[a] ?? cap(a), agent: a }))
    return { name: b.name, kind: (b.kind in PROJECT_TEMPLATES ? b.kind : "run") as ProjectKind, goal: b.goal, deliverable: b.deliverable, phases: [...b.phases, ...extra] }
  }
  const first = data.invocations[0]
  const goal = first ? partOf(first.user_prompt ?? "").split("\n")[0].slice(0, 220) : `Agents sharing memory in ${data.run.datapack}`
  return { name: `Run ${runId}`, kind: "run", goal, deliverable: "work", phases: order.map((a) => ({ id: a, label: ROLE_LABEL[a] ?? cap(a), agent: a })) }
}

/** A project task's prompt carries the brief; the report shows only the agent's own part. */
function partOf(prompt: string) {
  const m = /Your part \(([^)]*)\): ([\s\S]*?)(\n\nWork only on your part|$)/.exec(prompt)
  return m ? m[2].trim() : prompt.trim()
}

/** The end-of-session report: what the agents did, how they worked together, and what to change next time. */
export function SessionReportView() {
  const { state, setReportOpen } = useTower()
  return (
    <AnimatePresence>
      {state.reportOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Session report"
          data-report-root
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          className="fixed inset-0 z-50 overflow-y-auto bg-background"
          onKeyDown={(e) => e.key === "Escape" && setReportOpen(false)}
        >
          <Report />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Report() {
  const { state, setReportOpen } = useTower()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(state.source === "live")

  useEffect(() => {
    if (state.source !== "live") return
    let live = true
    setLoading(true)
    api.report(state.runId).then(
      (d) => live && setData(d),
      (e: Error) => live && toast.error("Couldn’t load the run’s task data", { description: e.message }),
    ).finally(() => live && setLoading(false))
    return () => void (live = false)
  }, [state.runId, state.source])

  const project = useMemo(() => projectFor(data, state.runId), [data, state.runId])
  // state.loaded: EVENTS is a live binding replaced when a run loads, so it must trigger a rebuild
  const report = useMemo(
    () => buildReport(project, EVENTS, state.issues, state.calls, PRIOR, data?.invocations ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, state.issues, state.calls, state.loaded, data],
  )
  const template = PROJECT_TEMPLATES[project.kind]
  const verdict = VERDICT[report.verdict]
  const run = RUNS.find((r) => r.run_id === state.runId) ?? RUNS[0]
  const digest = DIGEST && DIGEST.run_id === state.runId ? DIGEST : null
  const generated = useMemo(() => new Date().toISOString(), [])

  const copySummary = async () => {
    const rt = report.runtime
    const lines = [
      `${project.name} · ${template.label} · ${verdict.label}`,
      report.headline,
      `${when(report.startTs)} to ${when(report.endTs)} (${fmtSpan(report.durationSec)})`,
      `Tasks ${rt.tasks.length} (${rt.done} done, ${rt.failed} failed, ${rt.running} running) · tokens ${num(rt.inputTokens)} in / ${num(rt.outputTokens)} out · steps ${rt.tools} tools, ${rt.commands} commands, ${rt.files} files`,
      `Memory calls ${report.totals.calls} · issues ${report.issues.found} (${report.issues.fixed} fixed, ${report.issues.open} open) · stale reads ${pct(report.staleRate)} · team health ${report.health}/100`,
      ...report.agents.map((a) => `${cap(a.agent)}: ${a.tasksDone}/${a.tasks} tasks, ${a.writes + a.reads + a.handoffs} memory calls, ${a.issues} issues`),
    ]
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      toast.success("Summary copied")
    } catch {
      toast("Couldn’t copy. Your browser blocked clipboard access.")
    }
  }

  // the browser's own print-to-PDF: real text (searchable, selectable), laid out by the print styles
  const downloadPdf = () => {
    const title = document.title
    document.title = `${project.name} – session report – ${state.runId}`
    const restore = () => {
      document.title = title
      window.removeEventListener("afterprint", restore)
    }
    window.addEventListener("afterprint", restore)
    window.print()
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-5 sm:px-8">
          <Icon name="insights" size={24} className="text-primary" />
          <span className="text-[17px] font-bold">Session report</span>
          <span className="hidden truncate text-[15px] font-semibold text-muted-foreground sm:inline">· {state.runId}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" className="h-10 gap-2 rounded-xl px-4 text-[15px] font-bold" onClick={copySummary}>
              <Icon name="content_copy" size={18} />
              <span className="hidden md:inline">Copy summary</span>
            </Button>
            <Button variant="outline" className="h-10 gap-2 rounded-xl px-4 text-[15px] font-bold" onClick={downloadPdf} disabled={loading}>
              <Icon name="picture_as_pdf" size={18} />
              <span className="hidden md:inline">Download PDF</span>
            </Button>
            <Button className="h-10 gap-2 rounded-xl px-4 text-[15px] font-bold" onClick={() => setReportOpen(false)}>
              <Icon name="arrow_back" size={18} />
              <span className="hidden sm:inline">Back to session</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 sm:px-8 print:max-w-none print:gap-4 print:p-0">
        {/* letterhead, only on paper */}
        <div className="hidden items-center justify-between border-b pb-3 text-[12px] text-muted-foreground print:flex">
          <span className="font-bold text-foreground">Agent Control Tower · Session report</span>
          <span>Run {state.runId} · generated {when(generated)}</span>
        </div>

        {/* the project and its outcome */}
        <section className="report-block relative overflow-hidden rounded-3xl border bg-card p-7 sm:p-9" style={{ backgroundImage: "radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, var(--primary) 12%, transparent) 0%, transparent 55%), radial-gradient(80% 70% at 0% 100%, color-mix(in oklab, var(--agent-researcher) 8%, transparent) 0%, transparent 60%)" }}>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-[14px] font-bold text-ink-2">
              <Icon name="category" size={18} />
              {template.label}
            </span>
            <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] font-bold", verdict.className)}>
              <Icon name={verdict.icon} size={18} />
              {verdict.label}
            </span>
            {state.source !== "live" && <span className="inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-bold text-muted-foreground">Sample data</span>}
          </div>
          <h1 className="mt-4 text-[34px] leading-[1.1] font-bold tracking-[-0.025em] text-balance">{project.name}</h1>
          <p className="mt-2 max-w-[80ch] text-[16px] font-semibold text-muted-foreground">{project.goal}</p>
          <p className="mt-5 max-w-[75ch] text-[18px] leading-[1.6] font-semibold text-foreground">{loading ? "Loading the run’s tasks…" : report.headline}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[15px] font-semibold text-ink-2">
            <span className="flex items-center gap-2"><Icon name="schedule" size={20} className="text-muted-foreground" />{when(report.startTs)} to {clock(report.endTs)} · {fmtSpan(report.durationSec)}</span>
            {run && <span className="flex items-center gap-2"><Icon name="database" size={20} className="text-muted-foreground" />{run.datapack}</span>}
            {data?.brief?.workspace_id && <span className="flex items-center gap-2"><Icon name="folder_open" size={20} className="text-muted-foreground" />{data.brief.workspace_id}</span>}
            <span className="flex items-center gap-1.5">
              {report.agents.map((a) => <AgentGlyph key={a.agent} agent={a.agent} size={26} />)}
              <span className="ml-1">{report.agents.length} {report.agents.length === 1 ? "agent" : "agents"}</span>
            </span>
          </div>
        </section>

        {digest && <Digest digest={digest} />}
        <Kpis report={report} />
        <Timeline report={report} />

        <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
          <ChartCard icon="bar_chart" tone="var(--agent-researcher)" title="Activity over time" sub={`Memory calls and agent steps every ${fmtSpan(report.charts.binSec).replace(" 00s", "")}, by agent`}>
            <ActivityChart data={report.charts.activity} />
          </ChartCard>
          <ChartCard icon="monitor_heart" tone="var(--primary)" title="Team health" sub="Share of clean memory calls as the run went on · red dots raised an issue">
            <HealthChart data={report.charts.health} />
          </ChartCard>
          <ChartCard icon="update" tone="var(--agent-writer)" title="Memory freshness" sub="Did each agent read the newest version?">
            <FreshnessChart data={report.charts.freshness} />
          </ChartCard>
          <ChartCard icon="timer" tone="var(--agent-reviewer)" title="Time per phase" sub={`Where the ${project.deliverable}’s ${fmtSpan(report.durationSec)} went`}>
            <PhaseTimeChart data={report.charts.phaseTime} />
          </ChartCard>
        </div>

        <Agents report={report} />
        <TaskLog tasks={report.runtime.tasks} />
        <Memory report={report} />
        <NextRun report={report} />
        <Method report={report} generated={generated} digestModel={digest?.model} />
      </main>
    </div>
  )
}

/** The local summarizer's write-up of the run, labelled as such. */
function Digest({ digest }: { digest: NonNullable<typeof DIGEST> }) {
  const s = digest.summary
  return (
    <section className="report-block rounded-3xl border bg-card p-7">
      <SectionHead icon="auto_awesome" tone="var(--agent-analyst)" title="Executive summary" sub={`Written on this machine by ${digest.model}, from the run’s recorded events`} />
      <p className="mt-5 text-[16.5px] leading-relaxed font-semibold">{s.headline}</p>
      {s.by_agent.length > 0 && (
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {s.by_agent.map((a) => (
            <li key={a.agent} className="flex gap-2.5 rounded-xl bg-muted/50 px-3.5 py-2.5">
              <AgentGlyph agent={a.agent} size={22} />
              <span className="text-[14.5px] leading-snug"><b style={{ color: agentColor(a.agent) }}>{cap(a.agent)}</b> {a.summary}</span>
            </li>
          ))}
        </ul>
      )}
      {s.notable?.length > 0 && (
        <ul className="mt-4 list-disc pl-5 text-[14.5px] leading-relaxed text-ink-2">
          {s.notable.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </section>
  )
}

function Kpis({ report }: { report: SessionReport }) {
  const { totals, issues, runtime: rt } = report
  const healthTone = report.health >= 85 ? "good" : report.health >= 60 ? "warning" : "critical"
  const tiles = [
    { icon: "task_alt", tone: "var(--primary)", label: "Agent tasks", value: String(rt.tasks.length), sub: `${rt.done} done · ${rt.failed} failed · ${rt.running} running`, alert: rt.failed > 0 },
    { icon: "token", tone: "var(--agent-analyst)", label: "Tokens", value: compact(rt.inputTokens + rt.outputTokens), sub: `${num(rt.inputTokens)} in · ${num(rt.outputTokens)} out` },
    { icon: "terminal", tone: "var(--agent-publisher)", label: "Agent steps", value: String(rt.tools + rt.commands + rt.files), sub: `${rt.tools} tools · ${rt.commands} commands · ${rt.files} files` },
    { icon: "hub", tone: "var(--agent-researcher)", label: "Memory calls", value: String(totals.calls), sub: `${totals.writes} writes · ${totals.reads} reads · ${totals.handoffs} handoffs`, spark: totals.calls > 1 },
    { icon: "report", tone: "var(--flag)", label: "Issues found", value: String(issues.found), sub: `${issues.fixed} fixed · ${issues.open} open`, alert: issues.open > 0 },
    { icon: "history_toggle_off", tone: "var(--agent-reviewer)", label: "Stale reads", value: pct(report.staleRate), sub: `${report.staleReads.length} of ${totals.reads} reads were out of date`, alert: report.staleReads.length > 0 },
    { icon: "hourglass_top", tone: "var(--agent-writer)", label: "Agent time", value: fmtSpan(rt.busySec), sub: "time agents spent on tasks (they can overlap)" },
  ]
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="report-block flex flex-col rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2.5 text-[14px] font-bold text-muted-foreground">
            <span className="grid size-8 place-items-center rounded-lg" style={{ color: t.tone, background: `color-mix(in oklab, ${t.tone} 13%, transparent)` }}>
              <Icon name={t.icon} size={19} />
            </span>
            {t.label}
          </div>
          <div className={cn("mt-3 text-[34px] leading-none font-bold tracking-[-0.03em] tabular-nums", t.alert && "text-flag")}>{t.value}</div>
          <div className="mt-2 text-[13.5px] font-semibold text-muted-foreground">{t.sub}</div>
          {t.spark && (
            <div className="mt-auto pt-2">
              <Sparkline data={report.charts.cumulative} dataKey="calls" color={t.tone} />
            </div>
          )}
        </div>
      ))}
      <div className="report-block flex items-center gap-4 rounded-2xl border bg-card p-5">
        <HealthRing value={report.health} tone={healthTone} />
        <div>
          <div className="text-[14px] font-bold text-muted-foreground">Team health</div>
          <div className="mt-1 flex items-center gap-1.5 text-[14px] font-bold" style={{ color: TONE[healthTone] }}>
            <Icon name={healthTone === "good" ? "check_circle" : healthTone === "warning" ? "warning" : "error"} size={18} />
            {healthTone === "good" ? "Working well" : healthTone === "warning" ? "Some friction" : "Needs attention"}
          </div>
        </div>
      </div>
    </section>
  )
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : num(n))

const TONE = { good: "var(--primary)", warning: "var(--agent-reviewer)", critical: "var(--flag)" } as const

function HealthRing({ value, tone }: { value: number; tone: keyof typeof TONE }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 76 76" className="size-[76px] shrink-0" role="img" aria-label={`Team health ${value} out of 100`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--muted)" strokeWidth="8" />
      <motion.circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke={TONE[tone]}
        strokeWidth="8"
        strokeLinecap="round"
        transform="rotate(-90 38 38)"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - value / 100) }}
        transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
      />
      <text x="38" y="38" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[20px] font-bold">
        {value}
      </text>
    </svg>
  )
}

/** Each phase as a bar from its agent's first to last activity, with memory calls ticked, tasks marked and problems in red. */
function Timeline({ report }: { report: SessionReport }) {
  const { state } = useTower()
  const [tip, setTip] = useState<{ x: number; y: number; text: string[] } | null>(null)
  const total = Math.max(report.durationSec, 1)
  const t0 = new Date(report.startTs).getTime() / 1000
  const offending = new Set(state.issues.map((i) => i.evidence.at(-1)))
  // about six labels, on round steps
  const step = [60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 86400].find((s) => total / s <= 6) ?? 86400
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step)
  const x = (ts: string) => ((new Date(ts).getTime() / 1000 - t0) / total) * 100

  return (
    <section className="report-block rounded-3xl border bg-card p-7">
      <SectionHead icon="view_timeline" tone="var(--agent-researcher)" title="Progress" sub="How the work moved through each phase, on the real clock" />
      <div className="relative mt-6" onMouseLeave={() => setTip(null)}>
        <div className="flex flex-col gap-3">
          {report.phases.map((p, i) => {
            const left = (p.start / total) * 100
            const width = Math.max(((p.end - p.start) / total) * 100, 1.5)
            const mine = EVENTS.filter((e) => e.agent === p.agent)
            const tasks = report.runtime.tasks.filter((t) => t.agent_id === p.agent)
            return (
              <div key={p.id} className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[190px_minmax(0,1fr)]">
                <div className="flex items-center gap-2.5">
                  <AgentGlyph agent={p.agent} size={30} />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold">{p.label}</div>
                    <div className="truncate text-[13px] font-semibold text-muted-foreground">{cap(p.agent)}</div>
                  </div>
                </div>
                <div className="relative h-11 rounded-xl bg-muted/70">
                  {p.calls + p.tasks > 0 && (
                    <motion.div
                      className="absolute top-1.5 bottom-1.5 rounded-lg"
                      style={{ left: `${left}%`, background: agentColor(p.agent) }}
                      initial={{ width: 0 }}
                      animate={{ width: `${width}%` }}
                      transition={{ duration: 0.7, delay: 0.15 + i * 0.12, ease: [0.2, 0.8, 0.2, 1] }}
                      onMouseMove={(e) => {
                        const box = (e.currentTarget.parentElement!.parentElement!.parentElement!.parentElement as HTMLElement).getBoundingClientRect()
                        setTip({
                          x: e.clientX - box.left,
                          y: e.clientY - box.top,
                          text: [`${p.label} · ${cap(p.agent)}`, `${clock(new Date((t0 + p.start) * 1000).toISOString(), true)} to ${clock(new Date((t0 + p.end) * 1000).toISOString(), true)}`, `${p.tasks} ${p.tasks === 1 ? "task" : "tasks"} · ${p.calls} memory calls · ${p.issues} ${p.issues === 1 ? "issue" : "issues"}`],
                        })
                      }}
                    />
                  )}
                  {mine.map((e) => {
                    const bad = offending.has(e.event_id)
                    return (
                      <span
                        key={e.event_id}
                        className={cn("pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white", bad ? "z-10 size-3.5 bg-flag" : "size-2 bg-white/90")}
                        style={{ left: `${x(e.ts)}%` }}
                      />
                    )
                  })}
                  {tasks.map((t) => (
                    <span key={t.invocation_id} className="pointer-events-none absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white ring-2 ring-foreground/40" style={{ left: `${x(t.created_at)}%` }} />
                  ))}
                  {p.done && (
                    <span className="absolute top-1/2 -right-1 grid size-6 translate-x-full -translate-y-1/2 place-items-center rounded-full bg-primary/10 text-primary">
                      <Icon name="check" size={16} weight={700} />
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 grid grid-cols-[150px_minmax(0,1fr)] gap-4 sm:grid-cols-[190px_minmax(0,1fr)]">
          <span />
          <div className="relative h-5 font-mono text-[12.5px] font-semibold text-muted-foreground">
            {ticks.map((t) => (
              <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(t / total) * 100}%` }}>
                {clock(new Date((t0 + t) * 1000).toISOString())}
              </span>
            ))}
          </div>
        </div>
        {tip && (
          <div className="pointer-events-none absolute z-20 rounded-xl border bg-popover px-3.5 py-2.5 text-[14px] font-semibold shadow-lg" style={{ left: tip.x + 14, top: tip.y + 14 }}>
            {tip.text.map((t, i) => (
              <div key={i} className={i === 0 ? "font-bold" : "text-muted-foreground"}>{t}</div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] font-semibold text-muted-foreground">
        <span className="flex items-center gap-2"><span className="size-2.5 rotate-45 bg-white ring-2 ring-foreground/40" />Task sent to the agent</span>
        <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-ink/40" />Memory call</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-flag" />Problem detected</span>
        <span className="flex items-center gap-2"><Icon name="check" size={16} className="text-primary" />Phase delivered its output</span>
      </div>
    </section>
  )
}

/** Per agent: tasks, tokens, steps, time, memory calls, issues and how clean its work was. */
function Agents({ report }: { report: SessionReport }) {
  return (
    <section className="report-block rounded-3xl border bg-card p-7">
      <SectionHead icon="groups" tone="var(--agent-publisher)" title="Agents" sub="Who did what, and how cleanly" />
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead>
            <tr className="border-b text-[12.5px] font-bold text-muted-foreground">
              <th className="py-2 pr-3 font-bold">Agent</th>
              <th className="px-3 py-2 text-right font-bold">Tasks</th>
              <th className="px-3 py-2 text-right font-bold">Steps</th>
              <th className="px-3 py-2 text-right font-bold">Tokens</th>
              <th className="px-3 py-2 text-right font-bold">Time</th>
              <th className="px-3 py-2 text-right font-bold">Memory calls</th>
              <th className="px-3 py-2 text-right font-bold">Issues</th>
              <th className="py-2 pl-3 text-right font-bold">Health</th>
            </tr>
          </thead>
          <tbody>
            {report.agents.map((a) => (
              <tr key={a.agent} className="border-b last:border-0">
                <td className="py-3 pr-3">
                  <span className="flex items-center gap-2.5">
                    <AgentGlyph agent={a.agent} size={28} />
                    <b className="text-[15px]" style={{ color: agentColor(a.agent) }}>{cap(a.agent)}</b>
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{a.tasksDone}/{a.tasks}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{a.steps}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{num(a.tokens)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{a.tasks ? fmtSpan(a.busySec) : "–"}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{a.writes + a.reads + a.handoffs}</td>
                <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", a.issues && "text-flag")}>{a.issues}</td>
                <td className={cn("py-3 pl-3 text-right text-[16px] font-bold tabular-nums", a.health < 100 ? "text-flag" : "text-primary")}>{a.health}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Every task an agent was given in this run: what it was asked, what it answered, and what it cost. */
function TaskLog({ tasks }: { tasks: RuntimeTask[] }) {
  if (!tasks.length) return null
  return (
    <section className="report-block rounded-3xl border bg-card p-7">
      <SectionHead icon="assignment" tone="var(--primary)" title="Task log" sub="Each task in order: the ask, the answer, the runtime and what it took" />
      <ol className="mt-5 flex flex-col gap-4">
        {tasks.map((t, i) => <TaskRow key={t.invocation_id} t={t} n={i + 1} />)}
      </ol>
    </section>
  )
}

function TaskRow({ t, n }: { t: RuntimeTask; n: number }) {
  const [open, setOpen] = useState(false)
  const s = STATUS[t.status] ?? STATUS.queued
  const took = t.completed_at ? fmtSpan(Math.max(0, Math.round((new Date(t.completed_at).getTime() - new Date(t.started_at ?? t.created_at).getTime()) / 1000))) : "–"
  const answer = t.final_response || t.error_message || ""
  const long = answer.length > 600
  return (
    <li className="report-block rounded-2xl border p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-[12.5px] font-bold text-muted-foreground">#{n}</span>
        <AgentGlyph agent={t.agent_id} size={24} />
        <b className="text-[15px]" style={{ color: agentColor(t.agent_id) }}>{cap(t.agent_id)}</b>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] text-muted-foreground">
          <RuntimeMark provider={t.provider} className="size-3.5" />
          {[RUNTIME_LABEL[t.provider] ?? t.provider, t.model].filter(Boolean).join(" · ")}
        </span>
        <span className={cn("ml-auto inline-flex items-center gap-1 text-[13.5px] font-bold", s.className)}>
          <Icon name={s.icon} size={17} />
          {s.label}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] font-semibold text-muted-foreground">
        <span>{when(t.created_at)}</span>
        <span>took {took}</span>
        <span>{num((t.input_tokens ?? 0) + (t.output_tokens ?? 0))} tokens</span>
        <span>{t.tools} tools · {t.commands} commands · {t.files} files</span>
        {t.approvals > 0 && <span>{t.approvals} permission {t.approvals === 1 ? "request" : "requests"}</span>}
        {t.workspace_id && <span>in {t.workspace_id}</span>}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] print:grid-cols-[2fr_3fr]">
        <div>
          <div className="text-[12px] font-bold text-muted-foreground uppercase">Asked</div>
          <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap text-ink-2">{partOf(t.user_prompt ?? "")}</p>
          {t.why && <p className="mt-1 text-[12.5px] text-muted-foreground">Why: {t.why}</p>}
        </div>
        <div>
          <div className="text-[12px] font-bold text-muted-foreground uppercase">{t.status === "completed" ? "Answered" : "Result"}</div>
          <p className={cn("mt-1 text-[14px] leading-relaxed whitespace-pre-wrap", t.status !== "completed" && answer && "text-flag", !open && long && "line-clamp-[10] print:line-clamp-none")}>
            {answer || (t.status === "running" || t.status === "queued" ? "Still working." : "No answer recorded.")}
          </p>
          {long && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-[13px] font-bold text-cobalt hover:underline print:hidden">
              {open ? "Show less" : "Show the full answer"}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** Every fact the team shared: how many versions, and who read which one. */
function Memory({ report }: { report: SessionReport }) {
  if (!report.facts.length) return null
  return (
    <section className="report-block rounded-3xl border bg-card p-7">
      <SectionHead icon="database" tone="var(--primary)" title="Shared memory" sub="Facts written to Meko and who read them" />
      <div className="mt-5 flex flex-col divide-y">
        {report.facts.map((f) => (
          <div key={f.fact} className="flex flex-wrap items-center gap-2.5 py-3.5 first:pt-0 last:pb-0">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 font-mono text-[13.5px] font-bold text-white">{f.fact}</span>
            <span className="text-[13.5px] font-semibold text-muted-foreground">{f.versions ? `${f.versions} ${f.versions === 1 ? "version" : "versions"}` : "from before the run"}</span>
            <span className="ml-auto flex flex-wrap justify-end gap-1.5">
              {f.readers.length === 0 && <span className="text-[13.5px] font-semibold text-muted-foreground">not read</span>}
              {f.readers.map((r, i) => (
                <span
                  key={i}
                  className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[13px] font-bold", r.stale ? "border-flag/40 bg-flag-soft text-flag" : "text-ink-2")}
                  title={r.stale ? `${cap(r.agent)} read an outdated version` : `${cap(r.agent)} read the latest version`}
                >
                  <span className="size-2 rounded-full" style={{ background: agentColor(r.agent) }} />
                  {cap(r.agent)} v{r.version}
                  {r.stale && <Icon name="history_toggle_off" size={15} />}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** What to change before the next run: fixes waiting for a decision, and lessons already learned. */
function NextRun({ report }: { report: SessionReport }) {
  const { state, decide, go, setReportOpen } = useTower()
  const pending = state.issues.filter((i) => isOpen(i))
  const decided = state.issues.filter((i) => !isOpen(i))
  const failed = report.runtime.tasks.filter((t) => ["failed", "timeout"].includes(t.status))
  if (!pending.length && !decided.length && !failed.length && !report.lessons.length) return null
  return (
    <section className="report-block rounded-3xl border bg-card p-7">
      <SectionHead icon="rocket_launch" tone="var(--agent-writer)" title="Before the next run" sub={pending.length || failed.length ? "Decide these so the same problems don’t come back" : "Every fix is decided"} />
      <div className="mt-5 grid gap-4 lg:grid-cols-3 print:grid-cols-2">
        {failed.map((t) => (
          <div key={t.invocation_id} className="flex flex-col rounded-2xl border border-flag/25 bg-flag-soft/40 p-5">
            <div className="flex items-center gap-2 text-[13.5px] font-bold text-flag">
              <Icon name="cancel" size={18} />
              Task failed · {cap(t.agent_id)}
            </div>
            <div className="mt-2 line-clamp-3 text-[15px] leading-snug font-bold">{partOf(t.user_prompt ?? "")}</div>
            <p className="mt-2 line-clamp-4 text-[14px] font-semibold text-ink-2">{t.error_message ?? "No error message recorded."}</p>
          </div>
        ))}
        {pending.map((i) => (
          <div key={i.issue_id} className="flex flex-col rounded-2xl border border-flag/25 bg-flag-soft/40 p-5">
            <div className="flex items-center gap-2 text-[13.5px] font-bold text-flag">
              <Icon name="error" size={18} />
              {ISSUE_LABEL[i.type]}
            </div>
            <div className="mt-2 text-[16px] leading-snug font-bold">{i.headline}</div>
            {i.fix ? (
              <p className="mt-2 flex-1 text-[14px] leading-relaxed font-semibold text-ink-2">
                {FIX_LABEL[i.fix.fix_type]} change for {cap(i.fix.target_agent)}: {i.fix.explanation}
              </p>
            ) : (
              <p className="mt-2 flex-1 text-[14px] font-semibold text-muted-foreground">A fix is still being drafted.</p>
            )}
            <div className="mt-4 flex gap-2 print:hidden">
              {i.fix && (
                <Button className="h-9 rounded-lg px-3.5 font-bold" onClick={() => decide(i.issue_id, "approved")}>
                  Approve fix
                </Button>
              )}
              <Button
                variant="outline"
                className="h-9 rounded-lg px-3.5 font-bold"
                onClick={() => {
                  setReportOpen(false)
                  go("issue", i.issue_id)
                }}
              >
                Details
              </Button>
            </div>
          </div>
        ))}
        {decided.map((i) => (
          <div key={i.issue_id} className="flex flex-col rounded-2xl border bg-muted/40 p-5">
            <div className={cn("flex items-center gap-2 text-[13.5px] font-bold", i.status === "approved" ? "text-primary" : "text-muted-foreground")}>
              <Icon name={i.status === "approved" ? "check_circle" : "do_not_disturb_on"} size={18} />
              {i.status === "approved" ? "Fixed" : "Dismissed"}
            </div>
            <div className="mt-2 text-[16px] leading-snug font-bold">{i.headline}</div>
            {i.fix && <p className="mt-2 text-[14px] font-semibold text-muted-foreground">{FIX_LABEL[i.fix.fix_type]} change for {cap(i.fix.target_agent)}</p>}
          </div>
        ))}
      </div>
      {report.lessons.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 text-[15px] font-bold">
            <Icon name="school" size={20} className="text-[var(--agent-writer)]" />
            Lessons promoted to team knowledge
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {report.lessons.map((l) => (
              <li key={l.call_id} className="rounded-xl bg-muted/60 px-4 py-3 text-[15px] font-semibold text-ink-2">{l.text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** Where every number comes from, and what stays private. */
function Method({ report, generated, digestModel }: { report: SessionReport; generated: string; digestModel?: string }) {
  return (
    <section className="report-block rounded-3xl border bg-card p-7 text-[14px] leading-relaxed text-ink-2">
      <SectionHead icon="fact_check" tone="var(--muted-foreground)" title="Method and privacy" sub={`Generated ${when(generated)} from the Control Tower database`} />
      <div className="mt-5 grid gap-6 md:grid-cols-2 print:grid-cols-2">
        <div>
          <h3 className="text-[14.5px] font-bold text-foreground">How it’s measured</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>The run spans its first and last recorded event: memory calls, and each task from when it was sent to when it finished ({fmtSpan(report.durationSec)}).</li>
            <li>Tasks, steps, tokens and answers come from each agent runtime’s own events (Claude Agent SDK, Codex App Server, Antigravity CLI); tokens are as the provider reported them.</li>
            <li>A stale read is a read of a fact after a newer version of it was written. Issues come from the tower’s detectors.</li>
            <li>Team health is the share of clean memory calls and successful tasks, minus 8 points for every issue still open.</li>
            {digestModel && <li>The executive summary was written by {digestModel} on this machine; every number above is counted, not generated.</li>}
          </ul>
        </div>
        <div>
          <h3 className="text-[14.5px] font-bold text-foreground">Privacy</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Everything here is stored and computed on this machine. The report is never uploaded; the PDF is made by your browser.</li>
            <li>API keys, tokens and passwords are redacted when events are captured, before they reach the database.</li>
            <li>Only this run is included. Chats synced from your Claude, Codex and Antigravity apps are not part of a project report.</li>
            <li>No email addresses or account details are stored; sign-in status is method and plan only.</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function ChartCard({ icon, tone, title, sub, children }: { icon: string; tone: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="report-block rounded-3xl border bg-card p-7">
      <SectionHead icon={icon} tone={tone} title={title} sub={sub} />
      <div className="mt-5">{children}</div>
    </section>
  )
}

function SectionHead({ icon, title, sub, tone = "var(--primary)" }: { icon: string; title: string; sub: string; tone?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ color: tone, background: `color-mix(in oklab, ${tone} 13%, transparent)` }}>
        <Icon name={icon} size={24} />
      </span>
      <div>
        <h2 className="text-[20px] font-bold tracking-[-0.01em]">{title}</h2>
        <p className="text-[14.5px] font-semibold text-muted-foreground">{sub}</p>
      </div>
    </div>
  )
}
