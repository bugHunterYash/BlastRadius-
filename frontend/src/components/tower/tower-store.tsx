"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react"
import { toast } from "sonner"
import { traceFrom, type Trace } from "@/lib/graph"
import { cap } from "@/lib/format"
import { CALLS, datapackOf, EVENTS, ISSUES, LATE_FIX } from "@/lib/sample-data"
import type { Fix, Issue, MekoCall } from "@/lib/types"

export type ViewKind = "run" | "issues" | "runs" | "agent" | "fact" | "issue" | "trace"
export interface View {
  kind: ViewKind
  id: string
}
export type Mode = "graph" | "replay" | "trace"
export type PanelTab = "chat" | "details"

interface State {
  view: View
  history: View[]
  mode: Mode
  /** how many events the graph shows; less than all only while replaying */
  replayN: number
  playing: boolean
  trace: Trace | null
  /** bumps every time a trace starts, so its animation replays */
  traceKey: number
  issues: Issue[]
  /** the shared chat: every Meko call, oldest first */
  calls: MekoCall[]
  panelTab: PanelTab
  /** event picked in the chat, lit up on the graph */
  highlight: string | null
  searchOpen: boolean
}

type Action =
  | { type: "go"; view: View }
  | { type: "back" }
  | { type: "mode"; mode: Exclude<Mode, "trace"> }
  | { type: "trace"; eventId: string }
  | { type: "replay"; n: number }
  | { type: "play"; playing: boolean }
  | { type: "tick" }
  | { type: "decide"; issueId: string; decision: "approved" | "rejected" }
  | { type: "fixReady"; issueId: string; fix: Fix }
  | { type: "search"; open: boolean }
  | { type: "tab"; tab: PanelTab }
  | { type: "highlight"; eventId: string | null }
  | { type: "calls"; calls: MekoCall[] }

const HOME: View = { kind: "run", id: "run-42" }
const DEFAULT_TRACE = "ev02" // price v1, the ₹499 that reached the published post

const initial: State = {
  view: HOME,
  history: [],
  mode: "graph",
  replayN: EVENTS.length,
  playing: false,
  trace: null,
  traceKey: 0,
  issues: ISSUES,
  calls: CALLS,
  panelTab: "chat",
  highlight: null,
  searchOpen: false,
}

const leaveTrace = (s: State): State => {
  if (s.view.kind !== "trace") return { ...s, trace: null }
  const history = [...s.history]
  return { ...s, trace: null, view: history.pop() ?? HOME, history }
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "go": {
      if (s.view.kind === a.view.kind && s.view.id === a.view.id) return { ...s, panelTab: "details" }
      const next = { ...s, view: a.view, panelTab: "details" as const, history: [...s.history, s.view].slice(-20) }
      return s.mode === "trace" && a.view.kind !== "trace" ? { ...next, mode: "graph", trace: null } : next
    }
    case "back": {
      const history = [...s.history]
      const view = history.pop()
      if (!view) return s
      if (view.kind === "trace") return { ...s, view, history, mode: "trace", trace: traceFrom(EVENTS, view.id), traceKey: s.traceKey + 1 }
      return { ...s, view, history, mode: s.mode === "trace" ? "graph" : s.mode, trace: s.mode === "trace" ? null : s.trace }
    }
    case "mode": {
      const base = leaveTrace(s)
      return a.mode === "replay"
        ? { ...base, mode: "replay", replayN: 0, playing: true }
        : { ...base, mode: "graph", replayN: EVENTS.length, playing: false }
    }
    case "trace": {
      const view: View = { kind: "trace", id: a.eventId }
      const same = s.view.kind === "trace" && s.view.id === a.eventId
      return {
        ...s,
        mode: "trace",
        playing: false,
        replayN: EVENTS.length,
        trace: traceFrom(EVENTS, a.eventId),
        traceKey: s.traceKey + 1,
        view,
        panelTab: "details",
        history: same ? s.history : [...s.history, s.view].slice(-20),
      }
    }
    case "replay":
      return { ...s, replayN: a.n, playing: false }
    case "play":
      return { ...s, playing: a.playing, replayN: a.playing && s.replayN >= EVENTS.length ? 0 : s.replayN }
    case "tick": {
      const replayN = Math.min(EVENTS.length, s.replayN + 1)
      return { ...s, replayN, playing: replayN < EVENTS.length }
    }
    case "decide":
      return { ...s, issues: s.issues.map((i) => (i.issue_id === a.issueId ? { ...i, status: a.decision } : i)) }
    case "fixReady":
      return { ...s, issues: s.issues.map((i) => (i.issue_id === a.issueId ? { ...i, fix: a.fix, status: "fix_ready" } : i)) }
    case "search":
      return { ...s, searchOpen: a.open }
    case "tab":
      return { ...s, panelTab: a.tab }
    case "highlight":
      return { ...s, highlight: a.eventId }
    case "calls":
      return { ...s, calls: [...s.calls, ...a.calls] }
  }
}

let seq = 0
const now = () => new Date().toISOString()
const call = (c: Omit<MekoCall, "call_id" | "ts">): MekoCall => ({ ...c, call_id: `live-${++seq}`, ts: now() })

interface Tower {
  state: State
  go: (kind: ViewKind, id: string) => void
  back: () => void
  setMode: (mode: Mode) => void
  trace: (eventId: string) => void
  setReplay: (n: number) => void
  setPlaying: (playing: boolean) => void
  decide: (issueId: string, decision: "approved" | "rejected") => void
  setSearchOpen: (open: boolean) => void
  setTab: (tab: PanelTab) => void
  setHighlight: (eventId: string | null) => void
  postNote: (text: string) => void
}

const TowerContext = createContext<Tower | null>(null)

export function TowerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)

  const go = useCallback((kind: ViewKind, id: string) => dispatch({ type: "go", view: { kind, id } }), [])
  const back = useCallback(() => dispatch({ type: "back" }), [])
  const trace = useCallback((eventId: string) => dispatch({ type: "trace", eventId }), [])
  const setMode = useCallback((mode: Mode) => (mode === "trace" ? dispatch({ type: "trace", eventId: DEFAULT_TRACE }) : dispatch({ type: "mode", mode })), [])
  const setReplay = useCallback((n: number) => dispatch({ type: "replay", n }), [])
  const setPlaying = useCallback((playing: boolean) => dispatch({ type: "play", playing }), [])
  const setSearchOpen = useCallback((open: boolean) => dispatch({ type: "search", open }), [])
  const setTab = useCallback((tab: PanelTab) => dispatch({ type: "tab", tab }), [])
  const setHighlight = useCallback((eventId: string | null) => dispatch({ type: "highlight", eventId }), [])
  const postNote = useCallback((text: string) => {
    dispatch({ type: "calls", calls: [call({ actor: "you", kind: "note", datapack: "content-team", text })] })
  }, [])
  const decide = useCallback(
    (issueId: string, decision: "approved" | "rejected") => {
      dispatch({ type: "decide", issueId, decision })
      const issue = state.issues.find((i) => i.issue_id === issueId)
      const agent = issue?.agent ?? "agent"
      if (decision === "approved") {
        // a person's approval is itself a Meko call, and an approved fix becomes shared team knowledge
        dispatch({
          type: "calls",
          calls: [
            call({ actor: "you", kind: "approval", datapack: datapackOf(agent), to: agent, text: `Approved the fix for “${issue?.headline}”.` }),
            call({ actor: "you", kind: "promotion", datapack: "content-team", text: issue?.fix?.explanation ?? "Lesson promoted to team knowledge." }),
          ],
        })
        toast.success(`Fix approved for ${cap(agent)}`, { description: "Saved to Meko and promoted as a team lesson." })
      } else {
        dispatch({ type: "calls", calls: [call({ actor: "you", kind: "approval", datapack: datapackOf(agent), to: agent, text: `Dismissed the fix for “${issue?.headline}”.` })] })
        toast("Fix dismissed", { description: "Claude keeps it as an example for next time." })
      }
    },
    [state.issues],
  )

  // replay steps through one event at a time
  useEffect(() => {
    if (!state.playing) return
    const t = setInterval(() => dispatch({ type: "tick" }), 750)
    return () => clearInterval(t)
  }, [state.playing])

  // stands in for the fix.ready event on /v1/stream
  useEffect(() => {
    const t = setTimeout(() => {
      dispatch({ type: "fixReady", issueId: LATE_FIX.issue_id, fix: LATE_FIX.fix })
      toast("Claude drafted a fix for Publisher", { description: "Skipped handoff · routing change" })
    }, 5000)
    return () => clearTimeout(t)
  }, [])

  // ⌘K / Ctrl+K opens search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        dispatch({ type: "search", open: !state.searchOpen })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [state.searchOpen])

  const value = useMemo(
    () => ({ state, go, back, setMode, trace, setReplay, setPlaying, decide, setSearchOpen, setTab, setHighlight, postNote }),
    [state, go, back, setMode, trace, setReplay, setPlaying, decide, setSearchOpen, setTab, setHighlight, postNote],
  )
  return <TowerContext.Provider value={value}>{children}</TowerContext.Provider>
}

export function useTower() {
  const ctx = useContext(TowerContext)
  if (!ctx) throw new Error("useTower must be used inside <TowerProvider>")
  return ctx
}
