"use client"

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { buildReport, type SessionReport } from "@/lib/analytics"
import { isOpen } from "@/lib/graph"
import { agentColor, cap, clock, FIX_LABEL, ISSUE_LABEL } from "@/lib/format"
// the run on screen comes from the live data module; the project brief is still the sample's
import { EVENTS, PRIOR, RUNS } from "@/lib/data"
import { PROJECT, PROJECT_TEMPLATES } from "@/lib/sample-data"
import { AgentGlyph } from "./agent-glyph"
import { ActivityChart, FreshnessChart, HealthChart, PhaseTimeChart, Sparkline } from "./report-charts"
import { useTower } from "./tower-store"

const fmtDuration = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
const pct = (n: number) => `${Math.round(n * 100)}%`

/** Status colours are reserved for state and always ship with an icon and a word. */
const VERDICT = {
  clean: { label: "Delivered clean", icon: "check_circle", className: "bg-primary/10 text-primary" },
  "shipped-with-issues": { label: "Delivered with issues", icon: "error", className: "bg-flag-soft text-flag" },
  blocked: { label: "Needs follow-up", icon: "pending", className: "bg-[var(--agent-reviewer)]/10 text-[var(--agent-reviewer)]" },
} as const

/** The end-of-session report: what the agents built, how they worked together, and what to change next time. */
export function SessionReportView() {
  const { state, setReportOpen } = useTower()
  return (
    <AnimatePresence>
      {state.reportOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Session report"
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
  // state.loaded: EVENTS is a live binding replaced when a run loads, so it must trigger a rebuild
  // eslint-disable-next-line react-hooks/exhaustive-deps
    const report = useMemo(() => buildReport(PROJECT, EVENTS, state.issues, state.calls, PRIOR), [state.issues, state.calls, state.loaded])
  const template = PROJECT_TEMPLATES[PROJECT.kind]
  const verdict = VERDICT[report.verdict]

  const copySummary = async () => {
    const lines = [
      `${PROJECT.name} · ${template.label}`,
      report.headline,
      `Memory calls ${report.totals.calls} · issues ${report.issues.found} (${report.issues.fixed} fixed, ${report.issues.open} open) · stale reads ${pct(report.staleRate)} · team health ${report.health}/100`,
      ...report.phases.map((p) => `${p.label} (${cap(p.agent)}): ${p.calls} calls, ${p.issues} issues`),
    ]
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      toast.success("Summary copied")
    } catch {
      toast("Couldn’t copy. Your browser blocked clipboard access.")
    }
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-5 sm:px-8">
          <Icon name="insights" size={24} className="text-primary" />
          <span className="text-[17px] font-bold">Session report</span>
          <span className="hidden text-[15px] font-semibold text-muted-foreground sm:inline">· {(RUNS.find((r) => r.run_id === state.runId) ?? RUNS[0]).run_id}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" className="h-10 gap-2 rounded-xl px-4 text-[15px] font-bold" onClick={copySummary}>
              <Icon name="content_copy" size={18} />
              <span className="hidden sm:inline">Copy summary</span>
            </Button>
            <Button className="h-10 gap-2 rounded-xl px-4 text-[15px] font-bold" onClick={() => setReportOpen(false)}>
              <Icon name="arrow_back" size={18} />
              Back to session
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 sm:px-8">
        {/* the project and its outcome */}
        <section className="relative overflow-hidden rounded-3xl border bg-card p-7 sm:p-9" style={{ backgroundImage: "radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, var(--primary) 12%, transparent) 0%, transparent 55%), radial-gradient(80% 70% at 0% 100%, color-mix(in oklab, var(--agent-researcher) 8%, transparent) 0%, transparent 60%)" }}>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-[14px] font-bold text-ink-2">
              <Icon name="category" size={18} />
              {template.label}
            </span>
            <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] font-bold", verdict.className)}>
              <Icon name={verdict.icon} size={18} />
              {verdict.label}
            </span>
          </div>
          <h1 className="mt-4 text-[34px] leading-[1.1] font-bold tracking-[-0.025em] text-balance">{PROJECT.name}</h1>
          <p className="mt-2 text-[16px] font-semibold text-muted-foreground">{PROJECT.goal}</p>
          <p className="mt-5 max-w-[70ch] text-[18px] leading-[1.6] font-semibold text-foreground">{report.headline}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[15px] font-semibold text-ink-2">
            <span className="flex items-center gap-2"><Icon name="schedule" size={20} className="text-muted-foreground" />{clock(report.startTs)} to {clock(report.endTs)} · {fmtDuration(report.durationSec)}</span>
            <span className="flex items-center gap-2"><Icon name="database" size={20} className="text-muted-foreground" />{(RUNS.find((r) => r.run_id === state.runId) ?? RUNS[0]).datapack}</span>
            <span className="flex items-center gap-1.5">
              {report.agents.map((a) => <AgentGlyph key={a.agent} agent={a.agent} size={26} />)}
              <span className="ml-1">{report.agents.length} agents</span>
            </span>
          </div>
        </section>

        <Kpis report={report} />
        <Timeline report={report} />

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard icon="bar_chart" tone="var(--agent-researcher)" title="Activity over time" sub="Memory calls every 30 seconds, by agent">
            <ActivityChart data={report.charts.activity} />
          </ChartCard>
          <ChartCard icon="monitor_heart" tone="var(--primary)" title="Team health" sub="Share of clean calls as the run went on · red dots raised an issue">
            <HealthChart data={report.charts.health} />
          </ChartCard>
          <ChartCard icon="update" tone="var(--agent-writer)" title="Memory freshness" sub="Did each agent read the newest version?">
            <FreshnessChart data={report.charts.freshness} />
          </ChartCard>
          <ChartCard icon="timer" tone="var(--agent-reviewer)" title="Time per phase" sub={`Where the ${PROJECT.deliverable}’s ${fmtDuration(report.durationSec)} went`}>
            <PhaseTimeChart data={report.charts.phaseTime} />
          </ChartCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Agents report={report} />
          <Memory report={report} />
        </div>

        <NextRun report={report} />
      </main>
    </div>
  )
}

function Kpis({ report }: { report: SessionReport }) {
  const { totals, issues } = report
  const healthTone = report.health >= 85 ? "good" : report.health >= 60 ? "warning" : "critical"
  const tiles = [
    { icon: "hub", tone: "var(--agent-researcher)", label: "Memory calls", value: String(totals.calls), sub: `${totals.writes} writes · ${totals.reads} reads · ${totals.handoffs} handoffs`, spark: true },
    { icon: "report", tone: "var(--flag)", label: "Issues found", value: String(issues.found), sub: `${issues.fixed} fixed · ${issues.open} open`, alert: issues.open > 0 },
    { icon: "history_toggle_off", tone: "var(--agent-reviewer)", label: "Stale reads", value: pct(report.staleRate), sub: `${report.staleReads.length} of ${totals.reads} reads were out of date`, alert: report.staleReads.length > 0 },
    { icon: "database", tone: "var(--primary)", label: "Facts in memory", value: String(totals.facts), sub: `${totals.versions} versions written` },
  ]
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="flex flex-col rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2.5 text-[14px] font-bold text-muted-foreground">
            <span className="grid size-8 place-items-center rounded-lg" style={{ color: t.tone, background: `color-mix(in oklab, ${t.tone} 13%, transparent)` }}>
              <Icon name={t.icon} size={19} />
            </span>
            {t.label}
          </div>
          <div className={cn("mt-3 text-[36px] leading-none font-bold tracking-[-0.03em] tabular-nums", t.alert && "text-flag")}>{t.value}</div>
          <div className="mt-2 text-[14px] font-semibold text-muted-foreground">{t.sub}</div>
          {t.spark && (
            <div className="mt-auto pt-2">
              <Sparkline data={report.charts.cumulative} dataKey="calls" color={t.tone} />
            </div>
          )}
        </div>
      ))}
      <div className="flex items-center gap-4 rounded-2xl border bg-card p-5 sm:col-span-2 lg:col-span-1">
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

/** Each phase as a bar from its agent's first to last call, with every call ticked and problems marked. */
function Timeline({ report }: { report: SessionReport }) {
  const { state } = useTower()
  const [tip, setTip] = useState<{ x: number; y: number; text: string[] } | null>(null)
  const total = Math.max(report.durationSec, 1)
  const t0 = new Date(report.startTs).getTime() / 1000
  const offending = new Set(state.issues.map((i) => i.evidence.at(-1)))
  const ticks = Array.from({ length: Math.floor(total / 120) + 1 }, (_, i) => i * 120)

  return (
    <section className="rounded-3xl border bg-card p-7">
      <SectionHead icon="view_timeline" tone="var(--agent-researcher)" title="Progress" sub={`How the ${PROJECT.deliverable} moved through each phase`} />
      <div className="relative mt-6" onMouseLeave={() => setTip(null)}>
        <div className="flex flex-col gap-3">
          {report.phases.map((p, i) => {
            const left = (p.start / total) * 100
            const width = Math.max(((p.end - p.start) / total) * 100, 2)
            const mine = EVENTS.filter((e) => e.agent === p.agent)
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
                        text: [`${p.label} · ${cap(p.agent)}`, `${clock(mine[0].ts, true)} to ${clock(mine.at(-1)!.ts, true)}`, `${p.calls} calls · ${p.issues} ${p.issues === 1 ? "issue" : "issues"}`],
                      })
                    }}
                  />
                  {/* one tick per call, a red dot where a problem happened */}
                  {mine.map((e) => {
                    const x = ((new Date(e.ts).getTime() / 1000 - t0) / total) * 100
                    const bad = offending.has(e.event_id)
                    return (
                      <span
                        key={e.event_id}
                        className={cn("pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white", bad ? "z-10 size-3.5 bg-flag" : "size-2 bg-white/90")}
                        style={{ left: `${x}%` }}
                      />
                    )
                  })}
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
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / total) * 100}%` }}>
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
        <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-ink/40" />Memory call</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-flag" />Problem detected</span>
        <span className="flex items-center gap-2"><Icon name="check" size={16} className="text-primary" />Phase delivered its output</span>
      </div>
    </section>
  )
}

/** Per agent: what it did (one hue, stepped by kind of call), its issues, and how clean its calls were. */
function Agents({ report }: { report: SessionReport }) {
  const max = Math.max(...report.agents.map((a) => a.writes + a.reads + a.handoffs))
  return (
    <section className="rounded-3xl border bg-card p-7">
      <SectionHead icon="groups" tone="var(--agent-publisher)" title="Agents" sub="Who did what, and how cleanly" />
      <div className="mt-5 flex flex-col divide-y">
        {report.agents.map((a) => {
          const total = a.writes + a.reads + a.handoffs
          const parts = [
            { n: a.writes, label: "writes", opacity: 1 },
            { n: a.reads, label: "reads", opacity: 0.55 },
            { n: a.handoffs, label: "handoffs", opacity: 0.28 },
          ].filter((p) => p.n > 0)
          return (
            <div key={a.agent} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
              <AgentGlyph agent={a.agent} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[16px] font-bold" style={{ color: agentColor(a.agent) }}>{cap(a.agent)}</span>
                  <span className="text-[14px] font-semibold text-muted-foreground tabular-nums">{total} calls</span>
                </div>
                <div className="mt-2 flex h-3 gap-[2px]" style={{ width: `${(total / max) * 100}%` }} title={parts.map((p) => `${p.n} ${p.label}`).join(" · ")}>
                  {parts.map((p) => (
                    <span key={p.label} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flex: p.n, background: agentColor(a.agent), opacity: p.opacity }} />
                  ))}
                </div>
                <div className="mt-1.5 text-[13px] font-semibold text-muted-foreground">{parts.map((p) => `${p.n} ${p.label}`).join(" · ")}</div>
              </div>
              <div className="w-24 shrink-0 text-right">
                <div className={cn("text-[20px] font-bold tabular-nums", a.health < 100 ? "text-flag" : "text-primary")}>{a.health}%</div>
                <div className="text-[12.5px] font-semibold text-muted-foreground">{a.issues ? `${a.issues} ${a.issues === 1 ? "issue" : "issues"}` : "clean"}</div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Every fact the team shared: how many versions, and who read which one. */
function Memory({ report }: { report: SessionReport }) {
  return (
    <section className="rounded-3xl border bg-card p-7">
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
  return (
    <section className="rounded-3xl border bg-card p-7">
      <SectionHead icon="rocket_launch" tone="var(--agent-writer)" title="Before the next run" sub={pending.length ? "Decide these fixes so the same problems don’t come back" : "Every fix is decided"} />
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
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
              <p className="mt-2 flex-1 text-[14px] font-semibold text-muted-foreground">Claude is still drafting a fix.</p>
            )}
            <div className="mt-4 flex gap-2">
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

function ChartCard({ icon, tone, title, sub, children }: { icon: string; tone: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border bg-card p-7">
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
