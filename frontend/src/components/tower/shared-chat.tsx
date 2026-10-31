"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "@/components/ui/icon"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isOpen } from "@/lib/graph"
import { agentColor, cap, clock, ISSUE_LABEL } from "@/lib/format"
import { EVENTS, RUNS } from "@/lib/sample-data"
import type { CallKind, Issue, MekoCall } from "@/lib/types"
import { AgentGlyph } from "./agent-glyph"
import { seenIssues, useTower } from "./tower-store"

const VERB: Record<CallKind, string> = {
  note: "wrote",
  recall: "recalled",
  directive: "handed off to",
  promotion: "promoted",
  approval: "decided",
  error: "error",
}

/** Calls that have happened so far: run calls up to the stream position, plus anything people added live. */
export function useVisibleCalls() {
  const { state } = useTower()
  return useMemo(() => {
    const shown = new Set(EVENTS.slice(0, state.replayN).map((e) => e.event_id))
    return state.calls.filter((c) => !c.event_id || shown.has(c.event_id))
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
                const grouped = !!prev && prev.actor === c.actor
                return (
                  <motion.li key={c.call_id} {...enter} className={cn(grouped ? "mt-1.5" : "mt-7 first:mt-0")}>
                    {c.actor === "you" ? <PersonTurn call={c} /> : <AgentTurn call={c} grouped={grouped} issue={issueFor(c)} speaking={state.playing && i === calls.length - 1} />}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ol>
          {state.playing && !agent && <Working />}
        </div>
      </div>
      <Composer />
    </div>
  )
}

function AgentTurn({ call: c, grouped, issue, speaking }: { call: MekoCall; grouped: boolean; issue?: Issue; speaking: boolean }) {
  const { state, go, setHighlight } = useTower()
  const lit = !!c.event_id && state.highlight === c.event_id
  const event = c.event_id ? EVENTS.find((e) => e.event_id === c.event_id) : undefined
  const fact = event?.fact_key ? event : undefined
  return (
    <div className="flex gap-3.5">
      {grouped ? <span className="w-[30px] shrink-0" /> : <AgentMark name={c.actor} speaking={speaking} />}
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-[15.5px] font-bold" style={{ color: agentColor(c.actor) }}>{cap(c.actor)}</span>
            <span className="text-[13px] text-muted-foreground">{clock(c.ts, true)}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setHighlight(lit ? null : c.event_id ?? null)}
          className={cn("-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted/60", lit && "bg-cobalt-soft hover:bg-cobalt-soft")}
          aria-pressed={lit}
        >
          <span className="block text-[16.5px] leading-[1.6] text-foreground">{c.text}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
            <span className={cn("font-bold", KIND_TEXT[c.kind])}>{VERB[c.kind]}</span>
            {fact ? <MemoryChip fact={fact.fact_key!} version={fact.version!} write={fact.op === "write"} /> : c.to && <AgentChip agent={c.to} />}
            <span aria-hidden>·</span>
            <span className="font-mono text-[12.5px]">{c.datapack}</span>
          </span>
        </button>
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
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-cobalt px-4 py-2.5 text-[16.5px] leading-[1.55] text-white">{c.text}</div>
      <div className="mt-1.5 flex items-center gap-1.5 pr-1 text-[13px] text-muted-foreground">
        You <span className={cn("font-bold", KIND_TEXT[c.kind])}>{VERB[c.kind]}</span>
        <span aria-hidden>·</span>
        <span className="font-mono text-[12.5px]">{c.datapack}</span>
        <span aria-hidden>·</span>
        {clock(c.ts)}
      </div>
    </div>
  )
}

/** Top of the chat: live while the run streams, then the Summarizer's digest. */
function RunHeader() {
  const { state, go, setReportOpen } = useTower()
  const run = RUNS[0]
  const ended = state.replayN >= EVENTS.length
  const open = seenIssues(state).filter(isOpen)
  return (
    <header>
      <div className="flex items-center gap-2 text-[14.5px] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", ended ? "bg-mint" : "animate-pulse bg-flag")} />
        {ended ? "Run ended" : "Live"} · {run.run_id} · {run.datapack}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={ended ? "digest" : "live"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <h1 className="mt-3 text-[30px] leading-[1.15] font-bold tracking-[-0.025em] text-balance">{ended ? run.headline : "Four agents, one shared memory"}</h1>
          <p className="mt-3 max-w-[62ch] text-[16.5px] leading-[1.65] text-ink-2">
            {ended ? run.summary : "Every message here is a Meko call: what an agent wrote, recalled or handed off. Problems are flagged the moment they happen."}
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

function Composer() {
  const { postNote } = useTower()
  const [draft, setDraft] = useState("")
  const area = useRef<HTMLTextAreaElement>(null)
  const send = () => {
    const text = draft.trim()
    if (!text) return
    postNote(text)
    setDraft("")
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
      <div className="mx-auto w-full max-w-[740px] rounded-xl border bg-card p-2.5 transition-colors focus-within:border-cobalt/50 focus-within:ring-4 focus-within:ring-cobalt/10">
        <label htmlFor="chat-note" className="sr-only">
          Write to the shared memory
        </label>
        <textarea
          id="chat-note"
          ref={area}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Write to the shared memory…"
          className="block max-h-40 w-full resize-none bg-transparent px-1.5 pt-1 text-[16.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] text-muted-foreground">
            content-team
          </span>
          <span className="hidden text-[13px] text-muted-foreground sm:inline">Every agent recalls this on its next step</span>
          <Button type="submit" size="icon" className="ml-auto size-8 rounded-lg bg-cobalt text-white hover:bg-cobalt/90" disabled={!draft.trim()} aria-label="Send">
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

function AgentMark({ name, speaking }: { name: string; speaking: boolean }) {
  return (
    <span className="relative mt-0.5 shrink-0" aria-hidden>
      {/* the agent's icon in its colour code, the same mark as its node on the graph */}
      {speaking && <span className="absolute -inset-1 rounded-[30%] border [animation:pulse-ring_1.6s_ease-out_infinite]" style={{ borderColor: agentColor(name) }} />}
      <AgentGlyph agent={name} size={30} className="relative" />
    </span>
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
}
