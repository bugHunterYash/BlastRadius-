"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react"
import { toast } from "sonner"
import { traceFrom, type Trace } from "@/lib/graph"
import { cap } from "@/lib/format"
import { api, chatRun, loadSnapshot, STREAM_URL, type ExecEvent } from "@/lib/api"
import { applySnapshot, CALLS, CHAT_SESSIONS, DATAPACK, datapackOf, EVENTS, HEADLINE_TRACE, ISSUES, isChatCall, LATE_FIX, RUN_ID, SOURCE, type Source } from "@/lib/data"
import type { Fix, Issue, MekoCall } from "@/lib/types"

export type ViewKind = "run" | "issues" | "runs" | "agent" | "fact" | "issue" | "trace" | "live"
export interface View {
  kind: ViewKind
  id: string
}
export type Mode = "graph" | "replay" | "trace"
/** "details" slides the details drawer over the chat */
export type PanelTab = "chat" | "details"
/** the graph sits beside the chat, folds to a strip, or takes the whole workspace */
export type GraphView = "panel" | "collapsed" | "full"

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
  graphView: GraphView
  /** agent the chat is narrowed to, after picking it on the graph or in the sidebar */
  chatAgent: string | null
  /** the end-of-session report is open */
  reportOpen: boolean
  /** project folder whose workspace (every agent working in it) is open */
  workspace: string | null
  /** the "new project" dialog */
  newProjectOpen: boolean
  /** event picked in the chat, lit up on the graph */
  highlight: string | null
  searchOpen: boolean
  /** where the data comes from: the bundled sample, or the live backend */
  source: Source
  /** the run on screen; bumps `loaded` whenever its data is replaced */
  runId: string
  loaded: number
  /** the "connect your agents" dialog */
  accessOpen: boolean
  /** each agent's current conversation (agent_sessions id), so a follow-up continues it */
  chatSessions: Record<string, string>
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
  | { type: "upsertCall"; call: MekoCall }
  | { type: "graphView"; view: GraphView }
  | { type: "chatAgent"; agent: string | null }
  | { type: "report"; open: boolean }
  | { type: "workspace"; folder: string | null }
  | { type: "newProject"; open: boolean }
  | { type: "load"; issues: Issue[]; calls: MekoCall[]; runId: string; sameRun: boolean }
  | { type: "access"; open: boolean }
  | { type: "session"; agent: string; sessionId: string | null }

const homeOf = (runId: string): View => ({ kind: "run", id: runId })

const initial: State = {
  view: homeOf("run-42"),
  history: [],
  mode: "graph",
  // the sample run streams in on load, one Meko call at a time, the way it arrives over /v1/stream
  replayN: 0,
  playing: true,
  trace: null,
  traceKey: 0,
  issues: ISSUES,
  calls: CALLS,
  panelTab: "chat",
  graphView: "panel",
  chatAgent: null,
  reportOpen: false,
  workspace: null,
  newProjectOpen: false,
  highlight: null,
  searchOpen: false,
  source: "sample",
  runId: "run-42",
  loaded: 0,
  accessOpen: false,
  chatSessions: {},
}

const leaveTrace = (s: State): State => {
  if (s.view.kind !== "trace") return { ...s, trace: null }
  const history = [...s.history]
  return { ...s, trace: null, view: history.pop() ?? homeOf(s.runId), history }
}

/** Calls people added in the browser (notes, asks, answers) survive a reload of the run's data. */

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "go": {
      const chatAgent = a.view.kind === "agent" ? a.view.id : s.chatAgent
      if (s.view.kind === a.view.kind && s.view.id === a.view.id) return { ...s, panelTab: "details", chatAgent }
      const next = { ...s, view: a.view, panelTab: "details" as const, chatAgent, history: [...s.history, s.view].slice(-20) }
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
      const base = { ...leaveTrace(s), graphView: s.graphView === "collapsed" ? ("panel" as const) : s.graphView }
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
        graphView: s.graphView === "collapsed" ? "panel" : s.graphView,
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
    case "upsertCall": {
      const i = s.calls.findIndex((c) => c.call_id === a.call.call_id)
      if (i < 0) return { ...s, calls: [...s.calls, a.call] }
      const calls = [...s.calls]
      calls[i] = a.call
      return { ...s, calls }
    }
    case "graphView":
      return { ...s, graphView: a.view }
    case "chatAgent":
      return { ...s, chatAgent: a.agent }
    case "newProject":
      return { ...s, newProjectOpen: a.open }
    case "workspace":
      return { ...s, workspace: a.folder, panelTab: a.folder ? "chat" : s.panelTab }
    case "report":
      return { ...s, reportOpen: a.open, playing: a.open ? false : s.playing, replayN: a.open ? EVENTS.length : s.replayN }
    case "load": {
      // A live run shows everything at once; replay is still one click away.
      // Calls made in this browser are kept; when the database has the same one (a question and its
      // answer), the database wins unless its answer is still pending and ours has more.
      const byId = new Map(a.calls.map((c) => [c.call_id, c]))
      for (const c of s.calls.filter(isChatCall)) {
        const saved = byId.get(c.call_id)
        if (!saved || (saved.text === "…" && c.text !== "…")) byId.set(c.call_id, c)
      }
      const calls = [...byId.values()].sort((x, y) => new Date(x.ts).getTime() - new Date(y.ts).getTime())
      const chatSessions = { ...CHAT_SESSIONS, ...s.chatSessions }
      const base = { ...s, source: "live" as const, issues: a.issues, calls, chatSessions, runId: a.runId, loaded: s.loaded + 1 }
      if (a.sameRun && s.mode === "replay") return base
      const view = a.sameRun ? s.view : homeOf(a.runId)
      return { ...base, view, history: a.sameRun ? s.history : [], mode: s.mode === "trace" && a.sameRun ? s.mode : "graph",
               trace: a.sameRun ? s.trace : null, replayN: EVENTS.length, playing: false }
    }
    case "access":
      return { ...s, accessOpen: a.open }
    case "session": {
      const chatSessions = { ...s.chatSessions }
      if (a.sessionId) chatSessions[a.agent] = a.sessionId
      else delete chatSessions[a.agent]
      return { ...s, chatSessions }
    }
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
  ask: (agent: string, text: string) => Promise<void>
  openRun: (runId: string) => void
  setAccessOpen: (open: boolean) => void
  /** start a fresh conversation with an agent (the next question opens a new session) */
  newChat: (agent: string) => void
  setGraphView: (view: GraphView) => void
  setChatAgent: (agent: string | null) => void
  setReportOpen: (open: boolean) => void
  /** open the workspace of a project folder (null closes it) */
  openWorkspace: (folder: string | null) => void
  setNewProjectOpen: (open: boolean) => void
}

const TowerContext = createContext<Tower | null>(null)

interface Ask {
  agent: string
  text: string
}

export function TowerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const runRef = useRef<string | null>(null)
  const asks = useRef(new Map<string, Ask>())

  const go = useCallback((kind: ViewKind, id: string) => dispatch({ type: "go", view: { kind, id } }), [])
  const back = useCallback(() => dispatch({ type: "back" }), [])
  const trace = useCallback((eventId: string) => dispatch({ type: "trace", eventId }), [])
  const setMode = useCallback(
    (mode: Mode) => (mode === "trace" ? (HEADLINE_TRACE ? dispatch({ type: "trace", eventId: HEADLINE_TRACE.eventId }) : undefined) : dispatch({ type: "mode", mode })),
    [],
  )
  const setReplay = useCallback((n: number) => dispatch({ type: "replay", n }), [])
  const setPlaying = useCallback((playing: boolean) => dispatch({ type: "play", playing }), [])
  const setSearchOpen = useCallback((open: boolean) => dispatch({ type: "search", open }), [])
  const setTab = useCallback((tab: PanelTab) => dispatch({ type: "tab", tab }), [])
  const setHighlight = useCallback((eventId: string | null) => dispatch({ type: "highlight", eventId }), [])
  const setGraphView = useCallback((view: GraphView) => dispatch({ type: "graphView", view }), [])
  const setChatAgent = useCallback((agent: string | null) => dispatch({ type: "chatAgent", agent }), [])
  const setReportOpen = useCallback((open: boolean) => dispatch({ type: "report", open }), [])
  const openWorkspace = useCallback((folder: string | null) => dispatch({ type: "workspace", folder }), [])
  const setNewProjectOpen = useCallback((open: boolean) => dispatch({ type: "newProject", open }), [])
  const setAccessOpen = useCallback((open: boolean) => dispatch({ type: "access", open }), [])

  /** Load a run from the backend (the newest when runId is omitted). Falls back to the sample if it's down. */
  const load = useCallback(async (runId?: string) => {
    try {
      const snap = await loadSnapshot(runId ?? runRef.current ?? undefined)
      if (!snap) return
      const sameRun = runRef.current === snap.runId
      runRef.current = snap.runId
      const { issues, calls } = applySnapshot(snap)
      dispatch({ type: "load", issues, calls, runId: snap.runId, sameRun })
    } catch {
      if (SOURCE === "sample" && runRef.current === null) runRef.current = null // stay on the bundled sample
    }
  }, [])

  const openRun = useCallback((runId: string) => {
    runRef.current = runId
    void load(runId)
  }, [load])

  const postNote = useCallback((text: string) => {
    dispatch({ type: "calls", calls: [call({ actor: "you", kind: "note", datapack: DATAPACK, text })] })
    if (SOURCE === "live") api.note(text).catch((e) => toast.error("Couldn’t save the note", { description: String(e.message ?? e) }))
  }, [])

  /** Send a question to an agent's real runtime (Claude Code or Codex); its answer streams into the chat. */
  const sessionsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    sessionsRef.current = state.chatSessions
  }, [state.chatSessions])
  const newChat = useCallback((agent: string) => dispatch({ type: "session", agent, sessionId: null }), [])

  const ask = useCallback(async (agent: string, text: string) => {
    const sent = now()
    try {
      // a follow-up continues the agent's conversation (same Claude session / Codex thread)
      const inv = await api.invoke(agent, chatRun(), text, undefined, sessionsRef.current[agent])
      asks.current.set(inv.invocation_id, { agent, text: "" })
      dispatch({ type: "upsertCall", call: { call_id: `task-${inv.invocation_id}`, ts: sent, actor: "you", kind: "task", datapack: datapackOf(agent), to: agent, text } })
      dispatch({ type: "upsertCall", call: { call_id: `ans-${inv.invocation_id}`, ts: now(), actor: agent, kind: "answer", datapack: datapackOf(agent), text: "…" } })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      dispatch({ type: "calls", calls: [
        call({ actor: "you", kind: "task", datapack: datapackOf(agent), to: agent, text }),
        call({ actor: agent, kind: "error", datapack: datapackOf(agent), text: `Couldn’t start: ${msg}` }),
      ] })
      toast.error(`${cap(agent)} couldn’t take the task`, { description: msg })
    }
  }, [])

  const decide = useCallback(
    (issueId: string, decision: "approved" | "rejected") => {
      const issue = state.issues.find((i) => i.issue_id === issueId)
      const agent = issue?.agent ?? "agent"
      dispatch({ type: "decide", issueId, decision })
      const record = () => {
        if (decision === "approved") {
          // a person's approval is itself a Meko call, and an approved fix becomes shared team knowledge
          dispatch({
            type: "calls",
            calls: [
              call({ actor: "you", kind: "approval", datapack: datapackOf(agent), to: agent, text: `Approved the fix for “${issue?.headline}”.` }),
              call({ actor: "you", kind: "promotion", datapack: DATAPACK, text: issue?.fix?.explanation ?? "Lesson promoted to team knowledge." }),
            ],
          })
          toast.success(`Fix approved for ${cap(agent)}`, { description: "Applied, and saved to the shared memory as a team lesson." })
        } else {
          dispatch({ type: "calls", calls: [call({ actor: "you", kind: "approval", datapack: datapackOf(agent), to: agent, text: `Dismissed the fix for “${issue?.headline}”.` })] })
          toast("Fix dismissed", { description: "Claude keeps it as an example for next time." })
        }
      }
      if (SOURCE !== "live" || !issue?.fix) return record()
      api
        .decide(issue.fix.fix_id, decision === "approved" ? "approve" : "reject", "control-tower")
        .then(() => {
          record()
          void load()
        })
        .catch((e) => {
          toast.error("The decision wasn’t saved", { description: String(e.message ?? e) })
          void load()
        })
    },
    [state.issues, load],
  )

  // first load, then follow the backend's live stream
  useEffect(() => {
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 300)
    }
    const es = new EventSource(STREAM_URL)
    const memory = ["event.created", "run.status", "issue.created", "issue.updated", "digest.created", "fix.ready", "approval.recorded", "design.updated"]
    memory.forEach((n) => es.addEventListener(n, (ev) => {
      // a new run starting takes over the screen unless someone picked another run
      if (n === "event.created") {
        try {
          const d = JSON.parse((ev as MessageEvent).data)
          if (d.op === "run_start" && !String(d.run_id).startsWith("chat-")) runRef.current = d.run_id
        } catch {
          /* ignore */
        }
      }
      refresh()
    }))
    const onAgent = (ev: Event) => {
      let d: ExecEvent
      try {
        d = JSON.parse((ev as MessageEvent).data)
      } catch {
        return
      }
      const pending = asks.current.get(d.invocation_id)
      const t = d.event_type
      const isEnd = t === "agent.invocation.completed" || t === "agent.invocation.failed" || t === "agent.invocation.cancelled"
      if (!pending) {
        // an answer this tab didn't start (another tab, or before a reload): fetch it from the database
        if (isEnd && String(d.run_id).startsWith("chat-")) refresh()
        return
      }
      const p = d.payload as Record<string, unknown>
      if (t === "agent.message.delta") pending.text += String(p.text ?? "")
      else if (t === "agent.message.completed") pending.text = String(p.text ?? pending.text)
      else if (t === "agent.tool.started" && !pending.text) pending.text = `Using ${p.tool ?? "a tool"}…`
      const terminal = t === "agent.invocation.completed" || t === "agent.invocation.failed" || t === "agent.invocation.cancelled"
      let text = pending.text || "…"
      let kind: MekoCall["kind"] = "answer"
      if (terminal) {
        const final = p.final_response as string | null
        if (t === "agent.invocation.completed") text = final || pending.text || "(no answer)"
        else {
          kind = "error"
          text = `${t.endsWith("cancelled") ? "Cancelled" : "Failed"}: ${p.error ?? "no details"}`
        }
        asks.current.delete(d.invocation_id)
        const sid = p.session_id as string | null
        if (sid && t === "agent.invocation.completed") dispatch({ type: "session", agent: pending.agent, sessionId: sid })
      }
      dispatch({ type: "upsertCall", call: { call_id: `ans-${d.invocation_id}`, ts: d.timestamp, actor: pending.agent, kind, datapack: datapackOf(pending.agent), text } })
    }
    ;["agent.message.delta", "agent.message.completed", "agent.tool.started", "agent.invocation.completed", "agent.invocation.failed", "agent.invocation.cancelled"].forEach((n) =>
      es.addEventListener(n, onAgent),
    )
    return () => {
      clearTimeout(timer)
      es.close()
    }
  }, [load])

  // the stream and replay step through one event at a time
  useEffect(() => {
    if (!state.playing) return
    const t = setInterval(() => dispatch({ type: "tick" }), 900)
    return () => clearInterval(t)
  }, [state.playing])

  // when the run ends, offer its report
  const ended = state.replayN >= EVENTS.length && state.mode === "graph" && !state.reportOpen
  const reportOffered = useRef(false)
  useEffect(() => {
    if (!ended || reportOffered.current) return
    const t = setTimeout(() => {
      reportOffered.current = true
      toast("The run has ended", {
        description: "See how your agents did and what to fix before the next run.",
        action: { label: "View report", onClick: () => dispatch({ type: "report", open: true }) },
        duration: 10000,
      })
    }, 8000)
    return () => clearTimeout(t)
  }, [ended])

  // sample only: stands in for the fix.ready event on /v1/stream, a few seconds after the run ends
  const runEnded = state.replayN >= EVENTS.length
  const lateFixPending = !!LATE_FIX && state.issues.some((i) => i.issue_id === LATE_FIX!.issue_id && !i.fix)
  useEffect(() => {
    if (!runEnded || !lateFixPending || !LATE_FIX) return
    const late = LATE_FIX
    const t = setTimeout(() => {
      dispatch({ type: "fixReady", issueId: late.issue_id, fix: late.fix })
      toast("Claude drafted a fix for Publisher", { description: "Skipped handoff · routing change" })
    }, 3500)
    return () => clearTimeout(t)
  }, [runEnded, lateFixPending])

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
    () => ({ state, go, back, setMode, trace, setReplay, setPlaying, decide, setSearchOpen, setTab, setHighlight, postNote, ask, newChat, openRun, setAccessOpen, setGraphView, setChatAgent, setReportOpen, openWorkspace, setNewProjectOpen }),
    [state, go, back, setMode, trace, setReplay, setPlaying, decide, setSearchOpen, setTab, setHighlight, postNote, ask, newChat, openRun, setAccessOpen, setGraphView, setChatAgent, setReportOpen, openWorkspace, setNewProjectOpen],
  )
  return <TowerContext.Provider value={value}>{children}</TowerContext.Provider>
}

/** Issues whose offending event has already streamed in; the detectors can't have raised the rest yet. */
export function seenIssues(s: State) {
  const shown = new Set(EVENTS.slice(0, s.replayN).map((e) => e.event_id))
  return s.issues.filter((i) => shown.has(i.evidence.at(-1)!))
}

/** The run on screen (RUN_ID follows the loaded data). */
export const currentRun = () => RUN_ID

export function useTower() {
  const ctx = useContext(TowerContext)
  if (!ctx) throw new Error("useTower must be used inside <TowerProvider>")
  return ctx
}
