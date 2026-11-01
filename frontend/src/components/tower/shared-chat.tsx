"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "@/components/ui/icon"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isOpen } from "@/lib/graph"
import { agentColor, cap, clock, ISSUE_LABEL } from "@/lib/format"
import { AGENT_META, DATAPACK, DESIGN, DIGEST, EVENTS, PROVIDERS, RUNS } from "@/lib/data"
import type { CallKind, Issue, MekoCall } from "@/lib/types"
import { useAgentAuth } from "./agent-access"
import { AgentAvatar, RuntimeChip, RuntimeMark, RUNTIME_LABEL, runtimeLine } from "./runtime-logo"
import { seenIssues, useTower } from "./tower-store"
import { MemoryBadge } from "./meko-switch"

const VERB: Record<CallKind, string> = {
  note: "wrote",
  recall: "recalled",
  directive: "handed off to",
  promotion: "promoted",
  approval: "decided",
  error: "error",
  task: "asked",
  answer: "answered",
  prompt: "was asked",
  thought: "said",
  tool: "used a tool",
  command: "ran",
  file: "changed a file",
  result: "finished",
}

const STEP_KINDS: CallKind[] = ["tool", "command", "file"]

/** Calls that have happened so far: run calls up to the stream position, plus anything people added live. */
export function useVisibleCalls() {
  const { state } = useTower()
  return useMemo(() => {
    const shown = new Set(EVENTS.slice(0, state.replayN).map((e) => e.event_id))
    // while replaying, runtime steps appear when the replay reaches their moment
    const cutoff = state.replayN < EVENTS.length ? new Date(EVENTS[state.replayN - 1]?.ts ?? 0).getTime() : Infinity
    return state.calls.filter((c) => (c.event_id ? shown.has(c.event_id) : c.exec ? new Date(c.ts).getTime() <= cutoff : true))
  }, [state.calls, state.replayN])
}

const enter = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] as const } }

export function SharedChat() {
  const { state, setChatAgent } = useTower()
  const all = useVisibleCalls()
  // picking an agent on the graph narrows the chat to what that agent said or was told
  const agent = state.chatAgent
  const calls = agent ? all.filter((c) => c.actor === agent || c.to === agent) : all
  const scroller = useRef<HTMLDivElement>(null)
  const run = RUNS.find((r) => r.run_id === state.runId)
  const ended = state.replayN >= EVENTS.length && run?.status !== "running"

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [calls.length])

  const issueFor = (c: MekoCall) => state.issues.find((i) => c.event_id && i.evidence.at(-1) === c.event_id)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[740px] px-5 pt-10 pb-8 sm:px-8">
          <RunHeader />
          {agent && (
            <div className="sticky top-3 z-10 mt-6 flex w-fit items-center gap-2 rounded-full border bg-popover py-1 pr-1 pl-3.5 text-[14.5px] shadow-sm">
              Showing {cap(agent)}’s messages
              <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="Show all messages" onClick={() => setChatAgent(null)}>
                <Icon name="close" size={16} />
              </Button>
            </div>
          )}
          <ol className="mt-10 flex flex-col">
            <AnimatePresence initial={false}>
              {calls.map((c, i) => {
                const prev = calls[i - 1]
                const grouped = !!prev && prev.actor === c.actor && c.kind !== "result" && prev.kind !== "prompt" && c.actor !== "tower"
                return (
                  <motion.li key={c.call_id} {...enter} className={cn(grouped ? "mt-1.5" : "mt-7 first:mt-0")}>
                    {c.actor === "you" ? (
                      <PersonTurn call={c} />
                    ) : c.kind === "prompt" ? (
                      <TaskCard call={c} />
                    ) : (
                      <AgentTurn call={c} grouped={grouped} issue={issueFor(c)} speaking={state.playing && i === calls.length - 1} />
                    )}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ol>
          {state.playing && !agent && <Working />}
          {ended && !agent && <RunSummary />}
        </div>
      </div>
      <Composer />
    </div>
  )
}

/** The exact task the Control Tower sent to an agent's runtime. */
function TaskCard({ call: c }: { call: MekoCall }) {
  const to = c.to ?? ""
  return (
    <div className="overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-[13px] text-muted-foreground">
        <Icon name="assignment" size={18} className="text-cobalt" />
        <span>
          Task sent to <b className="font-bold" style={{ color: agentColor(to) }}>{cap(to)}</b>
        </span>
        <RuntimeChip agent={to} />
        <span className="ml-auto font-mono text-[12px] tabular-nums">{clock(c.ts, true)}</span>
      </div>
      <p className="px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-ink-2">{c.text}</p>
      {c.exec?.why && <p className="px-4 pb-3 text-[13px] text-muted-foreground">Why: {c.exec.why}</p>}
    </div>
  )
}

const STEP_ICON: Partial<Record<CallKind, string>> = { tool: "build", command: "terminal", file: "description" }

/** One runtime step: a tool call, a command or a file change, with its status, result and reason. */
export function StepRow({ call: c }: { call: MekoCall }) {
  const s = c.exec?.status
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-start gap-2">
        <Icon name={STEP_ICON[c.kind] ?? "build"} size={17} className="mt-px text-muted-foreground" />
        <code className="min-w-0 flex-1 font-mono text-[13px] leading-snug break-words text-foreground">{c.text}</code>
        <span className="flex shrink-0 items-center gap-1.5">
          {s === "ok" && <Icon name="check_circle" size={17} className="text-mint" />}
          {s === "failed" && <Icon name="cancel" size={17} className="text-destructive" />}
          {s === "running" && <Icon name="progress_activity" size={17} className="animate-spin text-muted-foreground" />}
          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{clock(c.ts, true)}</span>
        </span>
      </div>
      {c.exec?.detail && <p className="mt-1 truncate pl-6 font-mono text-[12px] text-muted-foreground">{c.exec.detail}</p>}
      {c.exec?.why && <p className="mt-1 pl-6 text-[13px] text-ink-2 italic">why: {c.exec.why}</p>}
    </div>
  )
}

function AgentTurn({ call: c, grouped, issue, speaking }: { call: MekoCall; grouped: boolean; issue?: Issue; speaking: boolean }) {
  const { state, go, setHighlight } = useTower()
  const lit = !!c.event_id && state.highlight === c.event_id
  const event = c.event_id ? EVENTS.find((e) => e.event_id === c.event_id) : undefined
  const fact = event?.fact_key ? event : undefined
  const isStep = STEP_KINDS.includes(c.kind)
  return (
    <div className="flex gap-3.5">
      {grouped ? <span className="w-[30px] shrink-0" /> : <AgentAvatar agent={c.actor} size={30} speaking={speaking} />}
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15.5px] font-bold" style={{ color: agentColor(c.actor) }}>{cap(c.actor)}</span>
            <RuntimeChip agent={c.actor} />
          </div>
        )}
        {isStep ? (
          <StepRow call={c} />
        ) : c.kind === "result" ? (
          <div className={cn("rounded-xl border px-4 py-3", c.exec?.status === "failed" ? "border-destructive/30 bg-destructive/5" : "border-mint/30 bg-mint/[0.06]")}>
            <div className="mb-1.5 flex items-center gap-2 text-[13px] font-bold text-muted-foreground">
              <Icon name={c.exec?.status === "failed" ? "cancel" : "check_circle"} size={17} className={c.exec?.status === "failed" ? "text-destructive" : "text-mint"} />
              Final answer
              <span className="ml-auto font-mono text-[12px] font-normal tabular-nums">{clock(c.ts, true)}</span>
            </div>
            <p className="text-[15.5px] leading-[1.6] whitespace-pre-wrap text-foreground">{c.text}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setHighlight(lit ? null : c.event_id ?? null)}
            className={cn("-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted/60", lit && "bg-cobalt-soft hover:bg-cobalt-soft")}
            aria-pressed={lit}
          >
            <span
              className={cn(
                "block leading-[1.6] whitespace-pre-wrap text-foreground",
                c.kind === "thought" ? "text-[15px] text-ink-2" : "text-[16.5px]",
                c.kind === "error" && "text-destructive",
              )}
            >
              {c.kind === "thought" && <Icon name="chat" size={16} className="mr-1.5 inline-block -translate-y-px align-middle text-muted-foreground" />}
              {c.text}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
              <span className={cn("font-bold", KIND_TEXT[c.kind])}>{VERB[c.kind]}</span>
              {fact ? <MemoryChip fact={fact.fact_key!} version={fact.version!} write={fact.op === "write"} /> : c.to && c.kind !== "prompt" && <AgentChip agent={c.to} />}
              <span aria-hidden>·</span>
              <span className="font-mono text-[12.5px]">{c.exec ? "agent runtime" : c.datapack}</span>
              <span aria-hidden>·</span>
              <span className="font-mono text-[12px] tabular-nums">{clock(c.ts, true)}</span>
            </span>
          </button>
        )}
        {issue && isOpen(issue) && (
          <div className="mt-3 overflow-hidden rounded-xl border border-flag/30 bg-flag-soft/60">
            <div className="flex items-center gap-2 border-b border-flag/20 px-4 py-2 text-[13.5px] font-bold text-flag">
              <Icon name="error" size={18} />
              {ISSUE_LABEL[issue.type]} detected
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <p className="min-w-0 flex-1 text-[15px] leading-snug text-ink-2">{issue.story}</p>
              <Button size="sm" className="h-8 shrink-0 rounded-lg bg-flag px-3 font-bold text-white hover:bg-flag/90" onClick={() => go("issue", issue.issue_id)}>
                Review
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PersonTurn({ call: c }: { call: MekoCall }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-cobalt px-4 py-2.5 text-[16.5px] leading-[1.55] whitespace-pre-wrap text-white">{c.text}</div>
      <div className="mt-1.5 flex items-center gap-1.5 pr-1 text-[13px] text-muted-foreground">
        You <span className={cn("font-bold", KIND_TEXT[c.kind])}>{VERB[c.kind]}</span>
        {c.kind === "task" && c.to && <AgentChip agent={c.to} />}
        <span aria-hidden>·</span>
        <span className="font-mono text-[12.5px]">{c.datapack}</span>
        <span aria-hidden>·</span>
        {clock(c.ts, true)}
      </div>
    </div>
  )
}

/** End of the run: the local Summarizer's digest, one line per agent, the detectors' findings, and counts. */
function RunSummary() {
  if (!DIGEST) return null
  const d = DIGEST.summary
  const ex = d.execution_summary as { total_invocations?: number; completed?: number; failed?: number } | undefined
  const local = DIGEST.model.startsWith("ollama:")
  return (
    <section className="mt-10 overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-[13px] text-muted-foreground">
        <Icon name="auto_awesome" size={18} className="text-cobalt" />
        <span className="font-bold text-foreground">Run summary</span>
        <span className="ml-auto rounded-full border px-2 py-px font-mono text-[12px]">
          {local ? `${DIGEST.model.replace("ollama:", "")} · local` : DIGEST.model === "fallback" ? "counted (model off)" : DIGEST.model}
        </span>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="text-[16.5px] leading-relaxed font-semibold text-foreground">{d.headline}</p>
        {d.by_agent.length > 0 && (
          <ul className="flex flex-col gap-3">
            {d.by_agent
              .filter((a) => a.agent !== "system")
              .map((a) => (
                <li key={a.agent} className="flex gap-3">
                  <AgentAvatar agent={a.agent} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[14px] font-bold" style={{ color: agentColor(a.agent) }}>
                      {cap(a.agent)}
                      {AGENT_META[a.agent]?.provider && (
                        <span className="inline-flex items-center gap-1 text-[12px] font-normal text-muted-foreground">
                          <RuntimeMark provider={AGENT_META[a.agent]?.provider} className="size-3.5" />
                          {runtimeLine(a.agent)}
                        </span>
                      )}
                    </div>
                    <p className="text-[14.5px] leading-snug text-ink-2">{a.summary}</p>
                  </div>
                </li>
              ))}
          </ul>
        )}
        {d.notable.length > 0 && (
          <div className="rounded-lg bg-flag-soft px-3 py-2 text-[14px] text-flag">
            {d.notable.map((n) => (
              <div key={n} className="flex gap-2">
                <Icon name="error" size={17} className="mt-px" />
                {n}
              </div>
            ))}
          </div>
        )}
        {ex && (ex.total_invocations ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2 text-[13px] text-muted-foreground">
            <span className="rounded-full border px-2 py-0.5">{ex.total_invocations} agent runs</span>
            <span className="rounded-full border px-2 py-0.5 text-mint">{ex.completed} completed</span>
            {!!ex.failed && <span className="rounded-full border px-2 py-0.5 text-destructive">{ex.failed} failed</span>}
          </div>
        )}
      </div>
    </section>
  )
}

/** Top of the chat: live while the run streams, then the Summarizer's headline. */
function RunHeader() {
  const { state, go, setReportOpen } = useTower()
  const run = RUNS.find((r) => r.run_id === state.runId) ?? RUNS[0]
  const ended = state.replayN >= EVENTS.length && run?.status !== "running"
  const open = seenIssues(state).filter(isOpen)
  if (!run) return null
  return (
    <header>
      <div className="flex items-center gap-2 text-[14.5px] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", ended ? "bg-mint" : "animate-pulse bg-flag")} />
        {ended ? "Run ended" : "Live"} · {run.run_id} · {run.datapack}
        <MemoryBadge mode={run.memory_mode} className="ml-1" />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={ended ? "digest" : "live"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <h1 className="mt-3 text-[30px] leading-[1.15] font-bold tracking-[-0.025em] text-balance">{ended ? run.headline : `${DESIGN.agents.length} agents, one shared memory`}</h1>
          <p className="mt-3 max-w-[62ch] text-[16.5px] leading-[1.65] text-ink-2">
            {ended ? run.summary : "Every message here is what an agent wrote, recalled or handed off, and every step its runtime took. Problems are flagged the moment they happen."}
          </p>
        </motion.div>
      </AnimatePresence>
      {ended && (
        <Button className="mt-5 h-10 gap-2 rounded-xl px-4 text-[15px] font-bold" onClick={() => setReportOpen(true)}>
          <Icon name="insights" size={20} />
          View session report
        </Button>
      )}
      {open.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {open.map((i) => (
              <motion.button
                key={i.issue_id}
                type="button"
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => go("issue", i.issue_id)}
                className="inline-flex h-8 items-center gap-2 rounded-full border bg-card px-3.5 text-[14.5px] transition-colors hover:bg-muted"
              >
                <span className="size-1.5 rounded-full bg-flag" />
                {i.headline}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </header>
  )
}

const MEMORY = "__memory__"

interface Target {
  id: string
  label: string
  sub: string
  provider?: string
  /** words a mention can match: the agent's name, its runtime, "claude", "codex"… */
  keys: string[]
}

/** The @mention being typed right before the caret, e.g. "@clau" → "clau". */
function mentionAt(text: string, caret: number): { query: string; start: number } | null {
  const m = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret))
  return m ? { query: m[2].toLowerCase(), start: caret - m[2].length - 1 } : null
}

const TAG = /(^|\s)@([\w-]+)/g

/** The target a tag names: its id first, then any of its keys ("@claude", "@codex"). */
const resolve = (word: string, targets: Target[]) => {
  const k = word.toLowerCase()
  return targets.find((t) => t.id === k) ?? targets.find((t) => t.keys.includes(k))
}

/** Everyone tagged in the message, in order, once each. */
function tagged(text: string, targets: Target[]): Target[] {
  const out: Target[] = []
  for (const m of text.matchAll(TAG)) {
    const hit = resolve(m[2], targets)
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}

/** "@writer @researcher compare these" → "compare these". Tags inside the sentence stay as context. */
function stripLeadingTags(text: string, targets: Target[]) {
  let rest = text.trim()
  for (let m = /^@([\w-]+)[\s,]*/.exec(rest); m && resolve(m[1], targets); m = /^@([\w-]+)[\s,]*/.exec(rest)) rest = rest.slice(m[0].length)
  return rest.trim()
}

function Composer() {
  const { state, postNote, ask, newChat, setAccessOpen } = useTower()
  const { auth } = useAgentAuth()
  const [draft, setDraft] = useState("")
  // where the message goes: the shared memory, or one agent's real runtime
  const [target, setTarget] = useState(MEMORY)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [pick, setPick] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)

  const askable = state.source === "live" ? DESIGN.agents.filter((a) => PROVIDERS[a]) : []
  const targets: Target[] = [
    ...askable.map((a) => {
      const prov = AGENT_META[a]?.provider ?? PROVIDERS[a]
      const runtime = RUNTIME_LABEL[prov] ?? prov
      return { id: a, label: cap(a), sub: runtimeLine(a) || runtime, provider: prov, keys: [a, prov, runtime.toLowerCase(), ...runtime.toLowerCase().split(" ")] }
    }),
    { id: MEMORY, label: "Shared memory", sub: `Write a note to ${DATAPACK}`, keys: ["memory", "notebook", "shared", DATAPACK] },
  ]
  const matches = mention
    ? targets
        .filter((t) => !mention.query || t.keys.some((k) => k.startsWith(mention.query)) || t.label.toLowerCase().includes(mention.query))
        .slice(0, 6)
    : []
  const open = matches.length > 0

  // tag several agents and the same message goes to each of them; no tag = the chip's target
  const tags = tagged(draft, targets)
  const recipients = tags.length ? tags.map((t) => t.id) : [target]
  const loggedOut = (id: string) => {
    const p = id === MEMORY ? null : PROVIDERS[id]
    const a = p === "claude" || p === "codex" || p === "antigravity" ? auth[p] : undefined
    return !!a && !a.logged_in
  }
  const provider = target === MEMORY ? null : PROVIDERS[target]
  const needsLogin = recipients.some(loggedOut)
  const loginFor = PROVIDERS[recipients.find(loggedOut) ?? ""]
  const inConversation = !tags.length && target !== MEMORY && !!state.chatSessions[target]

  const choose = (t: Target) => {
    // the tag stays in the text, so you can tag more agents in the same message
    const caret = area.current?.selectionStart ?? draft.length
    const start = mention?.start ?? caret
    const before = `${draft.slice(0, start)}@${t.id} `
    const next = before + draft.slice(caret).replace(/^\s+/, "")
    setDraft(next)
    requestAnimationFrame(() => area.current?.setSelectionRange(before.length, before.length))
    setMention(null)
    area.current?.focus()
  }

  const send = () => {
    const text = stripLeadingTags(draft, targets)
    if (!text) return
    if (needsLogin) return setAccessOpen(true)
    for (const to of recipients) {
      if (to === MEMORY) postNote(text)
      else void ask(to, text)
    }
    // one agent tagged: follow-ups go on to it without tagging again
    if (tags.length === 1) setTarget(tags[0].id)
    setDraft("")
    setMention(null)
  }

  // grow with the text, up to about six lines
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  return (
    <form
      className="shrink-0 px-5 pt-2 pb-5 sm:px-8"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <div className="relative mx-auto w-full max-w-[740px] rounded-xl border bg-card p-2.5 transition-colors focus-within:border-cobalt/50 focus-within:ring-4 focus-within:ring-cobalt/10">
        {open && (
          <ul role="listbox" aria-label="Send to" className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-[420px] overflow-hidden rounded-xl border bg-popover p-1 shadow-lg">
            <li className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-muted-foreground">Send to</li>
            {matches.map((t, i) => (
              <li key={t.id} role="option" aria-selected={i === pick}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setPick(i)}
                  onClick={() => choose(t)}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left", i === pick ? "bg-muted" : "hover:bg-muted/60")}
                >
                  {t.id === MEMORY ? <Icon name="database" size={22} className="text-muted-foreground" /> : <AgentAvatar agent={t.id} size={24} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold" style={t.id === MEMORY ? undefined : { color: agentColor(t.id) }}>{t.label}</span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">{t.sub}</span>
                  </span>
                  {t.provider && <RuntimeMark provider={t.provider} className="size-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor="chat-note" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-note"
          ref={area}
          rows={1}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setMention(mentionAt(e.target.value, e.target.selectionStart ?? e.target.value.length))
            setPick(0)
          }}
          onKeyDown={(e) => {
            if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault()
              setPick((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length)
              return
            }
            if (open && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault()
              choose(matches[Math.min(pick, matches.length - 1)])
              return
            }
            if (open && e.key === "Escape") {
              e.preventDefault()
              setMention(null)
              return
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          onBlur={() => setMention(null)}
          placeholder={target === MEMORY ? "Write to the shared memory, or type @ to ask an agent…" : `Message ${cap(target)}…`}
          className="block max-h-40 w-full resize-none bg-transparent px-1.5 pt-1 text-[16.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-2 flex items-center gap-2">
          {tags.length > 0 ? (
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
              <span className="text-muted-foreground">To</span>
              {tags.map((t) => (
                <span key={t.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border py-0 pr-2.5 pl-1.5">
                  {t.id === MEMORY ? <Icon name="database" size={16} className="text-muted-foreground" /> : <AgentAvatar agent={t.id} size={18} />}
                  <b className="font-semibold" style={t.id === MEMORY ? undefined : { color: agentColor(t.id) }}>{t.id === MEMORY ? DATAPACK : cap(t.id)}</b>
                </span>
              ))}
              {tags.length > 1 && <span className="text-muted-foreground">each gets the message</span>}
            </span>
          ) : target === MEMORY ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] text-muted-foreground">
              <Icon name="database" size={15} />
              {DATAPACK}
            </span>
          ) : (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border py-0 pr-1 pl-1.5 text-[13px]">
              <AgentAvatar agent={target} size={18} />
              <b className="font-semibold" style={{ color: agentColor(target) }}>{cap(target)}</b>
              <span className="text-muted-foreground">{RUNTIME_LABEL[provider!] ?? provider}</span>
              <button type="button" aria-label="Back to the shared memory" onClick={() => setTarget(MEMORY)} className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted">
                <Icon name="close" size={14} />
              </button>
            </span>
          )}
          {needsLogin ? (
            <Button type="button" size="sm" variant="secondary" className="h-7 gap-1.5 rounded-full text-[13px]" onClick={() => setAccessOpen(true)}>
              <Icon name="key" size={15} />
              Connect {RUNTIME_LABEL[loginFor] ?? loginFor}
            </Button>
          ) : inConversation ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className="truncate">Continues your conversation</span>
              <button type="button" onClick={() => newChat(target)} className="shrink-0 font-semibold text-cobalt hover:underline">
                New conversation
              </button>
            </span>
          ) : tags.length ? null : (
            <span className="hidden truncate text-[13px] text-muted-foreground sm:inline">
              {target === MEMORY ? "Type @ to tag agents; tag several to ask each" : `Runs on ${RUNTIME_LABEL[provider!] ?? provider}; every step is recorded`}
            </span>
          )}
          <Button type="submit" size="icon" className="ml-auto size-8 shrink-0 rounded-lg bg-cobalt text-white hover:bg-cobalt/90" disabled={!draft.trim() || needsLogin} aria-label="Send">
            <Icon name="arrow_upward" size={20} />
          </Button>
        </div>
      </div>
    </form>
  )
}

function Working() {
  const next = EVENTS[useTower().state.replayN]
  if (!next) return null
  return (
    <div className="mt-6 flex items-center gap-3.5 text-[15px] text-muted-foreground">
      <span className="grid size-7 place-items-center">
        <span className="flex gap-1">
          {[0, 1, 2].map((d) => (
            <motion.span key={d} className="size-1 rounded-full bg-muted-foreground" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }} />
          ))}
        </span>
      </span>
      {cap(next.agent)} is working…
    </div>
  )
}

/** The memory a call touched, as a small token: solid for a write, outlined for a read. */
function MemoryChip({ fact, version, write }: { fact: string; version: number; write: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md px-1.5 font-mono text-[12.5px]", write ? "bg-ink text-paper" : "border border-ink/25 text-ink")}>
      {fact}
      <span className="opacity-60">v{version}</span>
    </span>
  )
}

function AgentChip({ agent }: { agent: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-[12.5px] text-ink-2">
      <span className="size-1.5 rounded-full" style={{ background: agentColor(agent) }} />
      {cap(agent)}
    </span>
  )
}

/** The verb of each call, coloured by kind so a scan of the chat shows writes, reads and decisions apart. */
const KIND_TEXT: Record<CallKind, string> = {
  note: "text-primary",
  recall: "text-[var(--agent-researcher)]",
  directive: "text-[var(--agent-reviewer)]",
  promotion: "text-[var(--agent-writer)]",
  approval: "text-foreground",
  error: "text-destructive",
  task: "text-primary",
  answer: "text-mint",
  prompt: "text-primary",
  thought: "text-ink-2",
  tool: "text-muted-foreground",
  command: "text-muted-foreground",
  file: "text-primary",
  result: "text-mint",
}
