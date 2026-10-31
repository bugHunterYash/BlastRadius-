"use client"

import { CircleAlert, History, Moon, Sun, Waypoints, type LucideIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isOpen, latestVersion } from "@/lib/graph"
import { cap } from "@/lib/format"
import { DESIGN, EVENTS, LAYOUT, PRIOR, RUNS } from "@/lib/sample-data"
import { useTower, type ViewKind } from "./tower-store"

const FACTS = Object.keys(LAYOUT).filter((id) => !DESIGN.agents.includes(id))

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { state, go } = useTower()
  const { resolvedTheme, setTheme } = useTheme()
  const open = state.issues.filter(isOpen)
  const nav = (kind: ViewKind, id: string) => {
    go(kind, id)
    onNavigate?.()
  }
  const active = (kind: ViewKind, id: string) => state.view.kind === kind && state.view.id === id

  const NAV: { kind: ViewKind; id: string; icon: LucideIcon; label: string; count?: number; flag?: boolean }[] = [
    { kind: "run", id: "run-42", icon: Waypoints, label: "Overview" },
    { kind: "issues", id: "all", icon: CircleAlert, label: "Issues", count: open.length || undefined, flag: true },
    { kind: "runs", id: "all", icon: History, label: "Runs", count: RUNS.length },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col px-2.5 py-3.5">
      <div className="flex items-center gap-2.5 px-2 pt-1 pb-4">
        <span className="grid size-[22px] place-items-center rounded-md bg-foreground">
          <span className="size-2 rounded-full bg-background" />
        </span>
        <span className="text-sm font-semibold">Control Tower</span>
      </div>

      <nav className="flex flex-col gap-px">
        {NAV.map(({ kind, id, icon: Icon, label, count, flag }) => (
          <Item key={label} on={active(kind, id)} onClick={() => nav(kind, id)}>
            <Icon className="size-4" strokeWidth={1.7} />
            {label}
            {count !== undefined && <span className={cn("ml-auto text-xs tabular-nums", flag ? "font-medium text-flag" : "text-muted-foreground")}>{count}</span>}
          </Item>
        ))}
      </nav>

      <Group title="Agents">
        {DESIGN.agents.map((a) => {
          const n = open.filter((i) => i.agent === a).length
          return (
            <Item key={a} on={active("agent", a)} onClick={() => nav("agent", a)}>
              <span className="size-2 rounded-full bg-cobalt" />
              {cap(a)}
              {n > 0 && <span className="ml-auto text-xs font-medium text-flag">{n}</span>}
            </Item>
          )
        })}
      </Group>

      <Group title="Facts">
        {FACTS.map((f) => (
          <Item key={f} on={active("fact", f)} onClick={() => nav("fact", f)}>
            <span className="size-[7px] rounded-full border-[1.5px] border-cobalt" />
            {f}
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">v{latestVersion(f, EVENTS, PRIOR)?.version}</span>
          </Item>
        ))}
      </Group>

      <div className="mt-auto flex items-center gap-2 px-2 pt-3 text-[12.5px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-mint" />
        Live · content-team
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-muted-foreground"
          aria-label="Switch between light and dark"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="hidden size-4 dark:block" />
          <Moon className="size-4 dark:hidden" />
        </Button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 flex flex-col gap-px">
      <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{title}</div>
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
        "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13.5px] text-ink-2 transition-colors hover:bg-sidebar-accent hover:text-foreground",
        on && "bg-sidebar-accent font-medium text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export function Sidebar() {
  return (
    <aside className="hidden min-h-0 border-r bg-sidebar lg:block">
      <SidebarContent />
    </aside>
  )
}
