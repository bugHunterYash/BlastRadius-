"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isOpen } from "@/lib/graph"
import { cap, clock, ISSUE_TAG } from "@/lib/format"
import { EVENTS } from "@/lib/sample-data"
import type { CallKind, MekoCall } from "@/lib/types"
import { useTower } from "./tower-store"

const VERB: Record<CallKind, string> = {
  note: "wrote",
  recall: "recalled",
  directive: "handed off to",
  promotion: "promoted",
  approval: "approved",
  error: "error",
}

/** Calls the graph currently shows: everything when live, only what has happened so far in a replay. */
export function useVisibleCalls() {
  const { state } = useTower()
  return useMemo(() => {
    if (state.mode !== "replay") return state.calls
    const shown = new Set(EVENTS.slice(0, state.replayN).map((e) => e.event_id))
    return state.calls.filter((c) => c.event_id && shown.has(c.event_id))
  }, [state.calls, state.mode, state.replayN])
}

export function SharedChat() {
  const { state, go, setHighlight, postNote } = useTower()
  const calls = useVisibleCalls()
  const [draft, setDraft] = useState("")
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [calls.length])

  const issueFor = (c: MekoCall) => state.issues.find((i) => c.event_id && i.evidence.at(-1) === c.event_id)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-3 sm:px-6">
        <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          run-42 · content-team · 17:00
          <span className="h-px flex-1 bg-border" />
        </div>
        <ol className="flex flex-col">
          <AnimatePresence initial={false}>
            {calls.map((c, i) => {
              const prev = calls[i - 1]
              const grouped = prev && prev.actor === c.actor
              const issue = issueFor(c)
              const lit = !!c.event_id && state.highlight === c.event_id
              return (
                <motion.li
                  key={c.call_id}
                  layout="position"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={cn(grouped ? "mt-0.5" : "mt-3 first:mt-0")}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setHighlight(lit ? null : c.event_id ?? null)
                    }}
                    onDoubleClick={() => issue && go("issue", issue.issue_id)}
                    className={cn(
                      "group -mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted",
                      lit && "bg-cobalt-soft hover:bg-cobalt-soft",
                    )}
                  >
                    <Avatar actor={c.actor} hidden={grouped} />
                    <span className="min-w-0 flex-1">
                      {!grouped && (
                        <span className="flex items-baseline gap-2">
                          <span className="text-[13.5px] font-semibold">{c.actor === "you" ? "You" : cap(c.actor)}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{clock(c.ts)}</span>
                        </span>
                      )}
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted-foreground">
                        <KindDot kind={c.kind} />
                        {VERB[c.kind]}
                        {c.to && <span className="text-ink-2">{cap(c.to)}</span>}
                        <span>·</span>
                        <span className="font-mono">{c.datapack}</span>
                      </span>
                      <span className="mt-1 block text-[14px] leading-snug text-foreground">{c.text}</span>
                      {issue && isOpen(issue) && (
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            go("issue", issue.issue_id)
                          }}
                          onKeyDown={(e) => e.key === "Enter" && go("issue", issue.issue_id)}
                          className="mt-1.5 inline-flex h-6 items-center gap-1.5 rounded-full bg-flag-soft px-2.5 text-xs font-medium text-flag hover:underline"
                        >
                          <span className="size-1.5 rounded-full bg-flag" />
                          {ISSUE_TAG[issue.type]} · open issue
                        </span>
                      )}
                    </span>
                  </button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
        {state.mode === "replay" && calls.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Press play to watch the run unfold.</p>}
        <div ref={end} />
      </div>

      <form
        className="border-t bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault()
          const text = draft.trim()
          if (!text) return
          postNote(text)
          setDraft("")
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border bg-background p-1.5 pl-3 focus-within:border-foreground/25">
          <label htmlFor="chat-note" className="sr-only">
            Write a note to the team datapack
          </label>
          <input
            id="chat-note"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a note every agent can recall…"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
          />
          <Button type="submit" size="icon-sm" className="rounded-lg" disabled={!draft.trim()} aria-label="Post note">
            <ArrowUp className="size-4" />
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[11.5px] text-muted-foreground">Saved to the content-team datapack. Agents recall it on their next step.</p>
      </form>
    </div>
  )
}

function Avatar({ actor, hidden }: { actor: string; hidden?: boolean }) {
  if (hidden) return <span className="w-7 shrink-0" />
  const you = actor === "you"
  return (
    <span
      className={cn(
        "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
        you ? "bg-foreground text-background" : "bg-cobalt text-primary-foreground",
      )}
      aria-hidden
    >
      {you ? "Y" : actor.charAt(0).toUpperCase()}
    </span>
  )
}

const KIND_DOT: Record<CallKind, string> = {
  note: "bg-cobalt",
  recall: "border border-cobalt bg-transparent",
  directive: "bg-muted-foreground",
  promotion: "bg-mint",
  approval: "bg-foreground",
  error: "bg-destructive",
}

function KindDot({ kind }: { kind: CallKind }) {
  return <span className={cn("inline-block size-1.5 rounded-full", KIND_DOT[kind])} />
}
