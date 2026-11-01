"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { api, type MemoryModeState } from "@/lib/api"
import type { MemoryMode } from "@/lib/data"
import { cn } from "@/lib/utils"

/** Meko on or off for new tasks. Off: each agent works alone, reading and writing no shared memory. */
export function MekoSwitch() {
  const [mode, setMode] = useState<MemoryModeState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => void api.memoryMode().then(setMode, () => {}), [])
  if (!mode) return null

  const flip = async (on: boolean) => {
    setBusy(true)
    try {
      const next = await api.setMemoryMode(on)
      setMode(next)
      toast(on ? "Meko is on" : "Meko is off", {
        description: on
          ? "New tasks share memory: each agent reads what the team found and saves its own findings."
          : "New tasks work alone: no agent reads or writes shared memory.",
      })
    } catch (e) {
      toast.error("Couldn’t switch Meko", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <label
      htmlFor="meko-switch"
      title={mode.sharing ? (mode.mode === "meko" ? "Agents share memory through Meko" : "Agents share memory in a local table (no Meko URL set)") : "Each agent works alone"}
      className={cn(
        "flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[13.5px] font-semibold",
        mode.sharing ? "border-primary/40 bg-cobalt-soft/40 text-foreground" : "text-muted-foreground",
      )}
    >
      <span className={cn("size-2 rounded-full", mode.sharing ? "bg-primary" : "bg-muted-foreground/50")} />
      Meko {mode.sharing ? (mode.mode === "meko" ? "on" : "on · local") : "off"}
      <Switch id="meko-switch" checked={mode.sharing} disabled={busy} onCheckedChange={flip} />
    </label>
  )
}

const BADGE: Record<MemoryMode, { label: string; className: string }> = {
  meko: { label: "Meko on", className: "bg-cobalt-soft text-primary" },
  local: { label: "Shared memory · local", className: "bg-muted text-ink-2" },
  off: { label: "Meko off · agents alone", className: "bg-flag-soft text-flag" },
}

/** How a run's agents shared memory, recorded when it started. */
export function MemoryBadge({ mode, className }: { mode?: MemoryMode | null; className?: string }) {
  if (!mode) return null
  const b = BADGE[mode]
  return <span className={cn("rounded-full px-2 py-0.5 text-[12.5px] font-semibold", b.className, className)}>{b.label}</span>
}
