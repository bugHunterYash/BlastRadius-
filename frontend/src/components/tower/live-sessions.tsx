"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { clock } from "@/lib/format"
import { api, type Invocation, type LiveSession } from "@/lib/api"
import { toExecCalls, type ApiExecEvent, type ApiInvocation } from "@/lib/data"
import type { MekoCall } from "@/lib/types"
import { RuntimeMark, RUNTIME_LABEL } from "./runtime-logo"
import { StepRow } from "./shared-chat"

const APP_LABEL: Record<string, string> = { claude: "Claude app", codex: "Codex app", antigravity: "Antigravity" }
const SHOWN = 150

/** Re-run `fn` every `ms` while the tab is visible (and once right away). */
export function usePoll(fn: () => void, ms: number, deps: unknown[]) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && latest.current()
    tick()
    const t = setInterval(tick, ms)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Chats from the Claude and Codex apps, synced by the backend as they happen. */
export function useLiveSessions(enabled: boolean, limit = 12) {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  usePoll(() => {
    if (enabled) api.liveSessions(limit).then(setSessions, () => {})
  }, 5000, [enabled, limit])
  return sessions
}

export const sessionTitle = (s: { title?: string | null; run_id: string }) =>
  (s.title || "").replace(/\s+/g, " ").trim() || s.run_id

/** One synced chat, step by step, following along while it runs in the other app. */
export function LiveSessionView({ id, onOpenWorkspace, onHidden }: { id: string; onOpenWorkspace?: (folder: string) => void; onHidden?: () => void }) {
  const [inv, setInv] = useState<(Invocation & { metadata?: Record<string, unknown>; created_at?: string }) | null>(null)
  const [events, setEvents] = useState<ApiExecEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [hiding, setHiding] = useState(false)
  const last = useRef(0)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    last.current = 0
    setEvents([])
    setInv(null)
    setAll(false)
  }, [id])

  usePoll(() => {
    api.invocation(id).then((i) => setInv(i as typeof inv), (e: Error) => setError(e.message))
    api.stepsAfter(id, last.current).then((fresh) => {
      if (!fresh.length) return
      last.current = fresh[fresh.length - 1].sequence
      setEvents((prev) => [...prev, ...fresh.filter((e) => e.sequence > (prev.at(-1)?.sequence ?? 0))])
    }, () => {})
  }, 3000, [id])

  const calls: MekoCall[] = useMemo(
    () => (inv ? toExecCalls({ ...(inv as unknown as ApiInvocation), agent_id: inv.agent_id }, events) : []),
    [inv, events],
  )
  const shown = all ? calls : calls.slice(-SHOWN)

  // follow new steps
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [calls.length])

  if (error) return <p className="text-[15px] text-destructive">{error}</p>
  if (!inv) return <p className="text-[15px] text-muted-foreground">Loading…</p>

  const meta = inv.metadata ?? {}
  const running = inv.status === "running"
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <RuntimeMark provider={inv.provider} className="size-[18px]" />
          {APP_LABEL[inv.provider] ?? inv.provider} · synced live
          <span className={cn("ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px]", running && "border-mint/40 text-mint")}>
            <span className={cn("size-1.5 rounded-full", running ? "animate-pulse bg-mint" : "bg-muted-foreground")} />
            {running ? "Live now" : "Idle"}
          </span>
        </div>
        <h2 className="text-[22px] leading-tight font-bold">{sessionTitle({ title: meta.title as string, run_id: inv.run_id })}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13.5px]">
          <dt className="text-muted-foreground">Runtime</dt>
          <dd>{[RUNTIME_LABEL[inv.provider] ?? inv.provider, inv.model].filter(Boolean).join(" · ")}</dd>
          {typeof meta.cwd === "string" && (
            <>
              <dt className="text-muted-foreground">Folder</dt>
              <dd className="truncate font-mono text-[12.5px]" title={meta.cwd}>{meta.cwd}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Steps</dt>
          <dd className="tabular-nums">{calls.length}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          {onOpenWorkspace && typeof meta.cwd === "string" && (
            <Button className="w-fit gap-1.5 bg-cobalt text-white hover:bg-cobalt/90" onClick={() => onOpenWorkspace(meta.cwd as string)}>
              <Icon name="space_dashboard" size={18} />
              Open workspace
            </Button>
          )}
          {/* e.g. a chat from an earlier account: gone from the tower, still in its own app */}
          <Button
            variant="outline"
            className="w-fit gap-1.5 text-muted-foreground"
            disabled={hiding}
            onClick={() => {
              setHiding(true)
              api.hideSession(id).then(
                () => {
                  toast.success("Chat hidden", { description: "It won’t sync to the tower again. It’s still in its own app." })
                  onHidden?.()
                },
                (e: Error) => {
                  setHiding(false)
                  toast.error("Couldn’t hide the chat", { description: e.message })
                },
              )
            }}
          >
            <Icon name="visibility_off" size={18} />
            Hide from tower
          </Button>
        </div>
      </header>

      {calls.length > shown.length && (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setAll(true)}>
          Show {calls.length - shown.length} earlier steps
        </Button>
      )}

      <ol className="flex flex-col gap-2.5">
        {shown.map((c) => (
          <li key={c.call_id}>
            <LiveStep call={c} provider={inv.provider} />
          </li>
        ))}
      </ol>
      {!calls.length && <p className="text-[15px] text-muted-foreground">No steps yet.</p>}
      <div ref={end} />
    </div>
  )
}

function LiveStep({ call: c, provider }: { call: MekoCall; provider: string }) {
  if (c.kind === "prompt")
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[90%] rounded-2xl rounded-br-md bg-cobalt px-3.5 py-2 text-[14.5px] leading-[1.5] whitespace-pre-wrap text-white">
          {clip(c.text, 1200)}
        </div>
        <span className="mt-1 pr-1 font-mono text-[12px] text-muted-foreground tabular-nums">You · {clock(c.ts, true)}</span>
      </div>
    )
  if (c.kind === "command" || c.kind === "tool" || c.kind === "file") return <StepRow call={c} />
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border bg-card">
        <RuntimeMark provider={provider} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[14.5px] leading-[1.55] whitespace-pre-wrap", c.kind === "error" ? "text-destructive" : "text-foreground")}>
          {clip(c.text, 2000)}
        </p>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{clock(c.ts, true)}</span>
      </div>
    </div>
  )
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)

export function LiveDot({ on }: { on: boolean }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", on ? "animate-pulse bg-mint" : "bg-muted-foreground/40")} aria-label={on ? "live now" : undefined} />
}
