"use client"

import { useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { agentColor, cap, clock } from "@/lib/format"
import { api, type LiveSession, type Project } from "@/lib/api"
import { askedText, DESIGN, PROVIDERS, toExecCalls, type ApiExecEvent, type ApiInvocation } from "@/lib/data"
import type { MekoCall } from "@/lib/types"
import { useAgentAuth } from "./agent-access"
import { LiveDot, LiveSessionView, sessionTitle, useLiveSessions, usePoll } from "./live-sessions"
import { AgentAvatar, RuntimeMark, RUNTIME_LABEL, runtimeLine } from "./runtime-logo"
import { useTower } from "./tower-store"

const APP: Record<string, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" }
const RECENT = 30 // steps read per session for the shared feed

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
/** True when `path` is the folder or inside it. */
export const inFolder = (path: string | null | undefined, folder: string) =>
  !!path && (norm(path) === norm(folder) || norm(path).startsWith(`${norm(folder)}/`))
export const folderName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p

/** Project folders that synced sessions work in, busiest first. Nested folders count toward their parent. */
/** A drive root or a home folder ("C:/Users/me") is too broad to be a project. */
const tooBroad = (p: string) => norm(p).split("/").filter(Boolean).length <= 3

export function projectsOf(sessions: LiveSession[]) {
  const folders = [...new Set(sessions.map((s) => s.cwd).filter((c): c is string => !!c && !tooBroad(c)))]
  // a folder inside another one belongs to the outer project
  const roots = folders.filter((f) => !folders.some((o) => o !== f && inFolder(f, o)))
  return roots
    .map((folder) => {
      const mine = sessions.filter((s) => inFolder(s.cwd, folder))
      return { folder, sessions: mine, live: mine.filter((s) => s.status === "running").length,
               last: mine.map((s) => s.completed_at ?? s.created_at).sort().at(-1) ?? "" }
    })
    .sort((a, b) => b.live - a.live || b.last.localeCompare(a.last))
}

interface Row {
  agent: string
  task: string
}

interface TeamTask extends ApiInvocation {
  user_prompt?: string | null
  final_response?: string | null
}

/** Everything happening in one project: every agent's session, the team, one shared feed, and who does what next. */
export function ProjectWorkspace() {
  const { state, openWorkspace } = useTower()
  return (
    <AnimatePresence>
      {state.workspace && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Workspace: ${folderName(state.workspace)}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed inset-0 z-50 flex flex-col bg-background"
          onKeyDown={(e) => e.key === "Escape" && openWorkspace(null)}
        >
          <Workspace folder={state.workspace} onClose={() => openWorkspace(null)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Workspace({ folder, onClose }: { folder: string; onClose: () => void }) {
  const all = useLiveSessions(true, 60)
  const sessions = useMemo(() => all.filter((s) => inFolder(s.cwd, folder)), [all, folder])
  const [steps, setSteps] = useState<Record<string, ApiExecEvent[]>>({})
  const [project, setProject] = useState<Project | null>(null)
  const [team, setTeam] = useState<TeamTask[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const seen = useRef<Record<string, number>>({})

  // the newest steps of every session here, kept up to date
  usePoll(() => {
    for (const s of sessions.slice(0, 10)) {
      if (seen.current[s.invocation_id] === s.last_sequence) continue
      seen.current[s.invocation_id] = s.last_sequence
      api.stepsAfter(s.invocation_id, Math.max(0, s.last_sequence - RECENT)).then(
        (ev) => setSteps((m) => ({ ...m, [s.invocation_id]: ev })),
        () => {},
      )
    }
  }, 4000, [sessions])

  // the project's registration and the tasks the team was given here
  usePoll(() => {
    api.projects().then((ps) => {
      const p = ps.find((x) => norm(x.path) === norm(folder)) ?? null
      setProject(p)
      if (p) api.runInvocations(`project-${p.workspace_id}`, true).then((r) => setTeam(r.invocations as TeamTask[]), () => {})
    }, () => {})
  }, 4000, [folder])

  const feed = useMemo(() => {
    const items: { key: string; ts: string; provider: string; who: string; agent?: string; call: MekoCall }[] = []
    for (const s of sessions) {
      const calls = toExecCalls({ ...(s as unknown as ApiInvocation) }, steps[s.invocation_id] ?? [])
      for (const c of calls) items.push({ key: c.call_id, ts: c.ts, provider: s.provider, who: `${APP[s.provider] ?? s.provider} · ${sessionTitle(s)}`, call: c })
    }
    for (const t of team) {
      items.push({ key: `t-${t.invocation_id}`, ts: t.created_at, provider: t.provider, who: cap(t.agent_id), agent: t.agent_id,
                   call: { call_id: `t-${t.invocation_id}`, ts: t.created_at, actor: "you", kind: "task", datapack: "", to: t.agent_id, text: askedText(t.user_prompt) } })
      if (t.final_response || t.error_message)
        items.push({ key: `a-${t.invocation_id}`, ts: t.completed_at ?? t.created_at, provider: t.provider, who: cap(t.agent_id), agent: t.agent_id,
                     call: { call_id: `a-${t.invocation_id}`, ts: t.completed_at ?? t.created_at, actor: t.agent_id,
                             kind: t.status === "completed" ? "answer" : "error", datapack: "", text: t.final_response || t.error_message || "" } })
    }
    return items.sort((a, b) => a.ts.localeCompare(b.ts)).slice(-80)
  }, [sessions, steps, team])

  const live = sessions.filter((s) => s.status === "running").length
  const providers = [...new Set(sessions.map((s) => s.provider))]

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b px-5 py-3 sm:px-8">
        <span className="grid size-9 place-items-center rounded-lg bg-muted">
          <Icon name="folder_open" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[19px] leading-tight font-bold">{folderName(folder)}</h1>
          <p className="truncate font-mono text-[12px] text-muted-foreground" title={folder}>{folder}</p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] sm:inline-flex">
          <LiveDot on={live > 0} />
          {live ? `${live} working now` : "No one working right now"}
        </span>
        <span className="hidden items-center gap-1 sm:inline-flex">
          {providers.map((p) => <RuntimeMark key={p} provider={p} className="size-5" />)}
        </span>
        <Button variant="ghost" size="icon" aria-label="Close the workspace" onClick={onClose}>
          <Icon name="close" size={22} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-8">
            <section>
              <SectionTitle icon="groups" title="Who’s working here" note={`${sessions.length} session${sessions.length === 1 ? "" : "s"} from your apps`} />
              {sessions.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {sessions.map((s) => (
                    <SessionCard key={s.invocation_id} s={s} last={lastStep(s, steps[s.invocation_id])} onOpen={() => setOpenId(s.invocation_id)} />
                  ))}
                </div>
              ) : (
                <p className="text-[14.5px] text-muted-foreground">No synced Claude, Codex or Antigravity chats in this folder yet.</p>
              )}
            </section>

            <section>
              <SectionTitle icon="hub" title="Team on this project" note="Tower agents and what each was asked here" />
              <ul className="flex flex-col divide-y rounded-xl border bg-card">
                {DESIGN.agents.filter((a) => PROVIDERS[a]).map((a) => {
                  const mine = team.filter((t) => t.agent_id === a)
                  const cur = mine.at(-1)
                  return (
                    <li key={a} className="flex items-center gap-3 px-4 py-3">
                      <AgentAvatar agent={a} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <b className="text-[15px]" style={{ color: agentColor(a) }}>{cap(a)}</b>
                          <span className="truncate text-[12.5px] text-muted-foreground">{runtimeLine(a) || RUNTIME_LABEL[PROVIDERS[a]]}</span>
                        </div>
                        <p className="truncate text-[13.5px] text-ink-2">{cur ? askedText(cur.user_prompt) : "No task here yet"}</p>
                      </div>
                      {cur && <TaskStatus status={cur.status} />}
                    </li>
                  )
                })}
              </ul>
            </section>

            <section>
              <SectionTitle icon="timeline" title="Activity, every agent" note="Newest at the bottom" />
              {feed.length ? (
                <ol className="flex flex-col gap-2">
                  {feed.map(({ key, ...f }) => <FeedItem key={key} {...f} />)}
                </ol>
              ) : (
                <p className="text-[14.5px] text-muted-foreground">Nothing yet.</p>
              )}
            </section>
          </div>

          <aside className="lg:sticky lg:top-0 lg:self-start">
            <AssignPanel folder={folder} project={project} onProject={setProject} />
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {openId && (
          <motion.div
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-y-0 right-0 z-10 flex w-full max-w-[560px] flex-col border-l bg-background shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-end border-b px-3 py-2">
              <Button variant="ghost" size="icon" aria-label="Close the session" onClick={() => setOpenId(null)}>
                <Icon name="close" size={20} />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              <LiveSessionView id={openId} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function lastStep(s: LiveSession, ev?: ApiExecEvent[]): MekoCall | undefined {
  return ev ? toExecCalls({ ...(s as unknown as ApiInvocation) }, ev).at(-1) : undefined
}

function SectionTitle({ icon, title, note }: { icon: string; title: string; note?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <Icon name={icon} size={19} className="translate-y-[3px] text-muted-foreground" />
      <h2 className="text-[16px] font-bold">{title}</h2>
      {note && <span className="truncate text-[13px] text-muted-foreground">{note}</span>}
    </div>
  )
}

function SessionCard({ s, last, onOpen }: { s: LiveSession; last?: MekoCall; onOpen: () => void }) {
  const running = s.status === "running"
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-foreground/25", running && "border-mint/40")}
    >
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <RuntimeMark provider={s.provider} className="size-4" />
        {APP[s.provider] ?? s.provider}
        {s.model && <span className="truncate">· {s.model}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <LiveDot on={running} />
          {running ? "Working" : clock(s.completed_at ?? s.created_at)}
        </span>
      </div>
      <b className="line-clamp-2 text-[15px] leading-snug">{sessionTitle(s)}</b>
      <p className="line-clamp-2 min-h-[2.6em] text-[13px] leading-snug text-ink-2">
        {last ? `${last.kind === "prompt" ? "You: " : ""}${last.text}` : "…"}
      </p>
      <span className="font-mono text-[11.5px] text-muted-foreground">{s.last_sequence} steps · {folderName(s.cwd ?? "")}</span>
    </button>
  )
}

function TaskStatus({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    queued: ["Queued", "text-muted-foreground"],
    running: ["Working", "text-mint"],
    completed: ["Done", "text-mint"],
    failed: ["Failed", "text-destructive"],
    cancelled: ["Cancelled", "text-muted-foreground"],
    timeout: ["Timed out", "text-destructive"],
  }
  const [label, cls] = map[status] ?? [status, "text-muted-foreground"]
  return <span className={cn("shrink-0 text-[13px] font-semibold", cls)}>{label}</span>
}

function FeedItem({ ts, provider, who, agent, call: c }: { ts: string; provider: string; who: string; agent?: string; call: MekoCall }) {
  const step = c.kind === "command" || c.kind === "tool" || c.kind === "file"
  const mine = c.actor === "you" || c.kind === "prompt"
  return (
    <li className="flex gap-2.5">
      {agent ? <AgentAvatar agent={agent} size={22} /> : (
        <span className="grid size-[22px] shrink-0 place-items-center rounded-md border bg-card">
          <RuntimeMark provider={provider} className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
          <span className="truncate font-semibold" style={agent ? { color: agentColor(agent) } : undefined}>
            {mine ? `You → ${who}` : who}
          </span>
          <span className="ml-auto shrink-0 font-mono tabular-nums">{clock(ts, true)}</span>
        </div>
        <p
          className={cn(
            "text-[13.5px] leading-snug break-words",
            step ? "font-mono text-[12.5px] text-ink-2" : "whitespace-pre-wrap text-foreground",
            c.kind === "error" && "text-destructive",
            mine && "text-cobalt",
          )}
        >
          {step && <Icon name={c.kind === "command" ? "terminal" : c.kind === "file" ? "description" : "build"} size={14} className="mr-1 inline-block -translate-y-px align-middle" />}
          {c.text.length > 400 ? `${c.text.slice(0, 400)}…` : c.text}
        </p>
      </div>
    </li>
  )
}

/** Who does what: one task per agent, sent together. Runs in the project folder, read-only unless edits are allowed. */
function AssignPanel({ folder, project, onProject }: { folder: string; project: Project | null; onProject: (p: Project) => void }) {
  const { setAccessOpen } = useTower()
  const { auth } = useAgentAuth()
  const agents = DESIGN.agents.filter((a) => PROVIDERS[a])
  const [rows, setRows] = useState<Row[]>(() => agents.map((agent) => ({ agent, task: "" })))
  const [edits, setEdits] = useState(false)
  const [busy, setBusy] = useState(false)
  const ready = rows.filter((r) => r.task.trim())

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const assign = async () => {
    const blocked = ready.find((r) => {
      const p = PROVIDERS[r.agent] as "claude" | "codex" | "antigravity"
      return auth[p] && !auth[p]!.logged_in
    })
    if (blocked) {
      toast.error(`${cap(blocked.agent)} isn’t connected`, { description: `Sign in to ${RUNTIME_LABEL[PROVIDERS[blocked.agent]]} first.` })
      return setAccessOpen(true)
    }
    setBusy(true)
    try {
      const p = project ?? (await api.addProject(folder))
      onProject(p)
      const sent = await Promise.allSettled(
        ready.map((r) => api.invoke(r.agent, `project-${p.workspace_id}`, r.task.trim(), "Assigned from the project workspace", null,
                                    { workspaceId: p.workspace_id, readOnly: !edits })),
      )
      const ok = sent.filter((x) => x.status === "fulfilled").length
      const failed = sent.find((x): x is PromiseRejectedResult => x.status === "rejected")
      if (ok) toast.success(`${ok} task${ok === 1 ? "" : "s"} assigned`, { description: `Running in ${folderName(folder)}${edits ? "" : ", read-only"}.` })
      if (failed) toast.error("Some tasks couldn’t start", { description: String(failed.reason?.message ?? failed.reason) })
      setRows((rs) => rs.map((r) => ({ ...r, task: "" })))
    } catch (e) {
      toast.error("Couldn’t open this folder to the agents", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon name="assignment_ind" size={20} className="text-cobalt" />
        <h2 className="text-[16px] font-bold">Assign work</h2>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
        Give each agent its part. They run in this folder, side by side, and every step shows up in the feed.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2.5">
            <AgentAvatar agent={r.agent} size={26} />
            <div className="min-w-0 flex-1">
              <select
                aria-label="Agent"
                value={r.agent}
                onChange={(e) => set(i, { agent: e.target.value })}
                className="mb-1 h-7 w-full rounded-md border bg-background px-1.5 text-[13px] font-semibold"
                style={{ color: agentColor(r.agent) }}
              >
                {agents.map((a) => (
                  <option key={a} value={a}>{cap(a)} · {RUNTIME_LABEL[PROVIDERS[a]] ?? PROVIDERS[a]}</option>
                ))}
              </select>
              <textarea
                aria-label={`Task for ${cap(r.agent)}`}
                rows={2}
                value={r.task}
                onChange={(e) => set(i, { task: e.target.value })}
                placeholder={PLACEHOLDER[r.agent] ?? "What should this agent do here?"}
                className="block w-full resize-y rounded-md border bg-background px-2 py-1.5 text-[13.5px] leading-snug outline-none focus:border-cobalt/50"
              />
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows((rs) => [...rs, { agent: agents[0], task: "" }])} className="mt-2 text-[13px] font-semibold text-cobalt hover:underline">
        + Another task
      </button>
      <label className="mt-4 flex items-center gap-2.5 text-[13.5px]">
        <Switch checked={edits} onCheckedChange={setEdits} />
        Allow edits
        <span className="text-muted-foreground">{edits ? "agents with write access may change files" : "read-only"}</span>
      </label>
      <Button className="mt-4 w-full bg-cobalt text-white hover:bg-cobalt/90" disabled={!ready.length || busy} onClick={assign}>
        {busy ? "Assigning…" : ready.length ? `Assign ${ready.length} task${ready.length === 1 ? "" : "s"}` : "Write a task to assign"}
      </Button>
      {!project && <p className="mt-2 text-[12px] text-muted-foreground">The first assignment opens this folder to the tower’s agents.</p>}
    </div>
  )
}

const PLACEHOLDER: Record<string, string> = {
  researcher: "e.g. Map the services and what each depends on",
  writer: "e.g. Explain the architecture in a short README section",
  reviewer: "e.g. Review the latest changes for bugs and risks",
  publisher: "e.g. Draft the release notes",
  analyst: "e.g. Find what breaks first if Redis goes down",
}
