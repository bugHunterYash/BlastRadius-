"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { agentColor, cap } from "@/lib/format"
import { DESIGN, PROVIDERS } from "@/lib/data"
import { PROJECT_TEMPLATES, type ProjectKind } from "@/lib/sample-data"
import { useAgentAuth } from "./agent-access"
import { useLiveSessions } from "./live-sessions"
import { folderName, projectsOf } from "./project-workspace"
import { AgentAvatar, RUNTIME_LABEL } from "./runtime-logo"
import { useTower } from "./tower-store"

const KINDS: ProjectKind[] = ["software", "website", "content", "research", "training", "finetune"]

interface Part {
  label: string
  agent: string
  task: string
}

/** Agents for a kind's phases, in the design's order (research → researcher, and so on). */
function partsFor(kind: ProjectKind, agents: string[]): Part[] {
  return PROJECT_TEMPLATES[kind].phases.map((label, i) => ({ label, agent: agents[i % agents.length] ?? "", task: "" }))
}

/** Start a project: what it's for, which folder, and each agent's part. The run opens as soon as it starts. */
export function NewProject() {
  const { state, setNewProjectOpen, openRun, setAccessOpen } = useTower()
  const { auth } = useAgentAuth()
  const agents = DESIGN.agents.filter((a) => PROVIDERS[a])
  const sessions = useLiveSessions(state.newProjectOpen, 60)
  const folders = useMemo(() => projectsOf(sessions).map((p) => p.folder), [sessions])

  const [name, setName] = useState("")
  const [kind, setKind] = useState<ProjectKind>("software")
  const [goal, setGoal] = useState("")
  const [folder, setFolder] = useState("")
  const [parts, setParts] = useState<Part[]>(() => partsFor("software", agents))
  const [edits, setEdits] = useState(false)
  const [busy, setBusy] = useState(false)

  // agents arrive with the live design, after the first render
  useEffect(() => {
    if (state.newProjectOpen && parts.every((p) => !p.agent)) setParts(partsFor(kind, agents))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.newProjectOpen, agents.length])

  const set = (i: number, patch: Partial<Part>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const ready = parts.filter((p) => p.task.trim() && p.agent)
  const valid = name.trim() && goal.trim() && ready.length > 0

  const start = async () => {
    const offline = ready.find((p) => {
      const a = auth[PROVIDERS[p.agent] as "claude" | "codex" | "antigravity"]
      return a && !a.logged_in
    })
    if (offline) {
      toast.error(`${cap(offline.agent)} isn’t connected`, { description: `Sign in to ${RUNTIME_LABEL[PROVIDERS[offline.agent]]} first.` })
      return setAccessOpen(true)
    }
    setBusy(true)
    try {
      const p = await api.newProject({
        name: name.trim(), kind, goal: goal.trim(), folder: folder || null, allow_edits: edits,
        tasks: ready.map((r) => ({ agent: r.agent, task: r.task.trim(), label: r.label.trim() || undefined })),
      })
      toast.success(`${p.name} started`, { description: `${p.invocations.length} ${p.invocations.length === 1 ? "agent is" : "agents are"} on it${folder ? ` in ${folderName(folder)}` : ""}.` })
      setNewProjectOpen(false)
      setName("")
      setGoal("")
      setParts(partsFor(kind, agents))
      openRun(p.run_id)
    } catch (e) {
      toast.error("Couldn’t start the project", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={state.newProjectOpen} onOpenChange={setNewProjectOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Say what it’s for and give each agent its part. They start right away, and the run opens here.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <label className="grid gap-1.5 text-[13.5px] font-semibold">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Checkout revamp" />
            </label>
            <label className="grid gap-1.5 text-[13.5px] font-semibold">
              Kind
              <select
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as ProjectKind
                  setKind(k)
                  // keep tasks already written, relabel the rest
                  setParts((ps) => (ps.some((p) => p.task.trim()) ? ps : partsFor(k, agents)))
                }}
                className="h-9 rounded-md border bg-background px-2 text-[14px]"
              >
                {KINDS.map((k) => <option key={k} value={k}>{PROJECT_TEMPLATES[k].label}</option>)}
              </select>
            </label>
          </div>
          <label className="grid gap-1.5 text-[13.5px] font-semibold">
            Goal
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="What should be true when the team is done?"
              className="rounded-md border bg-background px-3 py-2 text-[14px] leading-snug font-normal outline-none focus:border-cobalt/50"
            />
          </label>
          <label className="grid gap-1.5 text-[13.5px] font-semibold">
            Folder
            <select value={folder} onChange={(e) => setFolder(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-[14px] font-normal">
              <option value="">Tower demo workspace (safe sandbox)</option>
              {folders.map((f) => <option key={f} value={f}>{folderName(f)} · {f}</option>)}
            </select>
            <span className="text-[12.5px] font-normal text-muted-foreground">Project folders are the ones your synced Claude, Codex or Antigravity chats work in.</span>
          </label>

          <div>
            <div className="mb-2 text-[13.5px] font-semibold">Who does what</div>
            <ol className="flex flex-col gap-2.5">
              {parts.map((p, i) => (
                <li key={i} className="flex gap-2.5 rounded-xl border p-2.5">
                  <AgentAvatar agent={p.agent} size={26} />
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="flex gap-2">
                      <Input value={p.label} onChange={(e) => set(i, { label: e.target.value })} maxLength={60} aria-label="Phase" className="h-8 w-36 text-[13px] font-semibold" />
                      <select
                        aria-label="Agent"
                        value={p.agent}
                        onChange={(e) => set(i, { agent: e.target.value })}
                        className="h-8 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-[13px] font-semibold"
                        style={{ color: agentColor(p.agent) }}
                      >
                        {agents.map((a) => <option key={a} value={a}>{cap(a)} · {RUNTIME_LABEL[PROVIDERS[a]] ?? PROVIDERS[a]}</option>)}
                      </select>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove this part" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
                        <Icon name="close" size={16} />
                      </Button>
                    </div>
                    <textarea
                      aria-label={`Task for ${cap(p.agent)}`}
                      rows={2}
                      value={p.task}
                      onChange={(e) => set(i, { task: e.target.value })}
                      maxLength={4000}
                      placeholder={`What should ${cap(p.agent)} do for “${p.label}”? Leave empty to skip.`}
                      className="rounded-md border bg-background px-2 py-1.5 text-[13.5px] leading-snug outline-none focus:border-cobalt/50"
                    />
                  </div>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => setParts((ps) => [...ps, { label: `Part ${ps.length + 1}`, agent: agents[0] ?? "", task: "" }])}
              className="mt-2 text-[13px] font-semibold text-cobalt hover:underline"
              disabled={parts.length >= 10}
            >
              + Add a part
            </button>
          </div>

          <label className="flex items-center gap-2.5 text-[13.5px]">
            <Switch checked={edits} onCheckedChange={setEdits} />
            Allow edits
            <span className="text-muted-foreground">{edits ? "agents with write access may change files" : "read-only: agents look, they don’t change files"}</span>
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setNewProjectOpen(false)}>Cancel</Button>
            <Button className="bg-cobalt text-white hover:bg-cobalt/90" disabled={!valid || busy} onClick={start}>
              {busy ? "Starting…" : `Start with ${ready.length} ${ready.length === 1 ? "agent" : "agents"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
