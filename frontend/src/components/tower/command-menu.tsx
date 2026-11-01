"use client"

import { Icon } from "@/components/ui/icon"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cap } from "@/lib/format"
import { DESIGN, FACTS, HEADLINE_TRACE, RUNS } from "@/lib/data"
import { AgentGlyph } from "./agent-glyph"
import { useTower } from "./tower-store"

export function CommandMenu() {
  const { state, go, trace, setMode, setSearchOpen, setAccessOpen } = useTower()
  const run = (fn: () => void) => () => {
    setSearchOpen(false)
    fn()
  }

  return (
    <CommandDialog open={state.searchOpen} onOpenChange={setSearchOpen} title="Search" description="Jump to an agent, fact, issue or action">
      <CommandInput placeholder="Search agents, facts, issues…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Issues">
          {state.issues.map((i) => (
            <CommandItem key={i.issue_id} value={`issue ${i.headline}`} onSelect={run(() => go("issue", i.issue_id))}>
              <Icon name="error" size={20} className="text-flag" />
              {i.headline}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          {HEADLINE_TRACE && (
            <CommandItem value={`trace where ${HEADLINE_TRACE.label} went`} onSelect={run(() => trace(HEADLINE_TRACE!.eventId))}>
              <Icon name="share" size={20} />
              Trace where {HEADLINE_TRACE.label} went
            </CommandItem>
          )}
          <CommandItem value={`replay ${state.runId}`} onSelect={run(() => setMode("replay"))}>
            <Icon name="replay" size={20} />
            Replay {state.runId}
          </CommandItem>
          <CommandItem value="connect agents sign in claude codex google" onSelect={run(() => setAccessOpen(true))}>
            <Icon name="key" size={20} />
            Connect agents
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Agents">
          {DESIGN.agents.map((a) => (
            <CommandItem key={a} value={`agent ${a}`} onSelect={run(() => go("agent", a))}>
              <AgentGlyph agent={a} size={22} />
              {cap(a)}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Facts">
          {FACTS().map((f) => (
            <CommandItem key={f} value={`fact ${f}`} onSelect={run(() => go("fact", f))}>
              <span className="size-3 rounded-[3px] bg-primary" />
              {f}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Runs">
          {RUNS.map((r) => (
            <CommandItem key={r.run_id} value={`run ${r.run_id}`} onSelect={run(() => go("run", r.run_id))}>
              <Icon name="history" size={20} />
              {r.run_id}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
