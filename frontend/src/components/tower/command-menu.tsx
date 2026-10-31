"use client"

import { Icon } from "@/components/ui/icon"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cap } from "@/lib/format"
import { DESIGN, LAYOUT, RUNS } from "@/lib/sample-data"
import { AgentGlyph } from "./agent-glyph"
import { useTower } from "./tower-store"

const FACTS = Object.keys(LAYOUT).filter((id) => !DESIGN.agents.includes(id))

export function CommandMenu() {
  const { state, go, trace, setMode, setSearchOpen } = useTower()
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
          <CommandItem value="trace where 499 went" onSelect={run(() => trace("ev02"))}>
            <Icon name="share" size={20} />
            Trace where ₹499 went
          </CommandItem>
          <CommandItem value="replay run 42" onSelect={run(() => setMode("replay"))}>
            <Icon name="replay" size={20} />
            Replay run-42
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
          {FACTS.map((f) => (
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
