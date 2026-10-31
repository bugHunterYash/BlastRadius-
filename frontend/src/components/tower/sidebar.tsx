"use client"

import { Icon } from "@/components/ui/icon"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isOpen, latestVersion } from "@/lib/graph"
import { cap } from "@/lib/format"
import { AGENT_META, DATAPACK, DESIGN, EVENTS, FACTS, PRIOR, PROVIDERS, RUNS } from "@/lib/data"
import { AgentAvatar, runtimeLine } from "./runtime-logo"
import { seenIssues, useTower, type ViewKind } from "./tower-store"

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { state, go, setAccessOpen } = useTower()
  const { resolvedTheme, setTheme } = useTheme()
  const open = seenIssues(state).filter(isOpen)
  const nav = (kind: ViewKind, id: string) => {
    go(kind, id)
    onNavigate?.()
  }
  const active = (kind: ViewKind, id: string) => state.view.kind === kind && state.view.id === id

  const NAV: { kind: ViewKind; id: string; icon: string; label: string; count?: number; flag?: boolean }[] = [
    { kind: "run", id: state.runId, icon: "hub", label: "Overview" },
    { kind: "issues", id: "all", icon: "error", label: "Issues", count: open.length || undefined, flag: true },
    { kind: "runs", id: "all", icon: "history", label: "Runs", count: RUNS.length },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col px-2.5 py-3.5">
      <div className="flex items-center gap-2.5 px-2 pt-1 pb-4">
        <span className="grid size-[22px] place-items-center rounded-md bg-foreground">
          <span className="size-2 rounded-full bg-background" />
        </span>
        <span className="text-[15px] font-bold">Control Tower</span>
      </div>

      <nav className="flex flex-col gap-px">
        {NAV.map(({ kind, id, icon, label, count, flag }) => (
          <Item key={label} on={active(kind, id)} onClick={() => nav(kind, id)}>
            <Icon name={icon} size={20} />
            {label}
            {count !== undefined && <span className={cn("ml-auto text-[13px] tabular-nums", flag ? "font-semibold text-flag" : "text-muted-foreground")}>{count}</span>}
          </Item>
        ))}
      </nav>

      <Group title="Agents">
        {DESIGN.agents.map((a) => {
          const n = open.filter((i) => i.agent === a).length
          return (
            <Item key={a} on={active("agent", a)} onClick={() => nav("agent", a)}>
              <AgentAvatar agent={a} size={20} />
              <span className="flex min-w-0 flex-col leading-tight">
                {cap(a)}
                {(AGENT_META[a]?.provider || PROVIDERS[a]) && (
                  <span className="truncate text-[11.5px] font-normal text-muted-foreground">{runtimeLine(a) || PROVIDERS[a]}</span>
                )}
              </span>
              {n > 0 && <span className="ml-auto text-[13px] font-semibold text-flag">{n}</span>}
            </Item>
          )
        })}
      </Group>

      <Group title="Facts">
        {FACTS().map((f) => (
          <Item key={f} on={active("fact", f)} onClick={() => nav("fact", f)}>
            <span className="size-[7px] rounded-full border-[1.5px] border-cobalt" />
            {f}
            {latestVersion(f, EVENTS, PRIOR) && (
              <span className="ml-auto font-mono text-[12.5px] text-muted-foreground">v{latestVersion(f, EVENTS, PRIOR)!.version}</span>
            )}
          </Item>
        ))}
      </Group>

      <div className="mt-auto pt-3">
        <Item on={state.accessOpen} onClick={() => setAccessOpen(true)}>
          <Icon name="key" size={20} />
          Connect agents
        </Item>
      </div>
      <div className="flex items-center gap-2 px-2 pt-2 text-[14px] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", state.source === "live" ? "bg-mint" : "bg-muted-foreground")} />
        {state.source === "live" ? `Live · ${DATAPACK}` : "Sample data · backend offline"}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-muted-foreground"
          aria-label="Switch between light and dark"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Icon name="contrast" size={20} />
        </Button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 flex flex-col gap-px">
      <div className="px-2 pb-1 text-[13px] font-semibold text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

function Item({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-[15px] text-ink-2 transition-colors hover:bg-sidebar-accent hover:text-foreground",
        on && "bg-sidebar-accent font-semibold text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export function Sidebar() {
  return (
    <aside className="hidden min-h-0 border-r bg-sidebar xl:block">
      <SidebarContent />
    </aside>
  )
}
