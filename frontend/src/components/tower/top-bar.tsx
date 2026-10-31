"use client"

import { useState } from "react"
import { Icon } from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SidebarContent } from "./sidebar"
import { useTower, type Mode } from "./tower-store"
import { AuthButton } from "./auth-button"

const MODES: { value: Mode; label: string }[] = [
  { value: "graph", label: "Graph" },
  { value: "replay", label: "Replay" },
  { value: "trace", label: "Trace" },
]

export function TopBar() {
  const { state, setMode, setSearchOpen, setReportOpen } = useTower()
  const [navOpen, setNavOpen] = useState(false)

  return (
    <header className="flex h-[52px] items-center gap-3 border-b px-3 sm:px-5">
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="xl:hidden" aria-label="Open navigation">
            <Icon name="menu" size={22} />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[15px] whitespace-nowrap text-muted-foreground">
        <span className="hidden sm:inline">Runs</span>
        <span className="hidden sm:inline">/</span>
        <span className="font-semibold text-foreground">run-42</span>
      </nav>

      <ToggleGroup
        type="single"
        value={state.mode}
        onValueChange={(v) => v && setMode(v as Mode)}
        spacing={0}
        className="ml-auto rounded-[9px] bg-muted p-[3px]"
        aria-label="Graph view"
      >
        {MODES.map((m) => (
          <ToggleGroupItem
            key={m.value}
            value={m.value}
            className="h-7 rounded-[7px]! border-0 px-3 text-[14.5px] text-ink-2 hover:bg-transparent hover:text-foreground data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
          >
            {m.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Button variant="outline" className="hidden h-8 gap-2 rounded-lg px-2.5 font-normal text-muted-foreground md:inline-flex" onClick={() => setSearchOpen(true)}>
        <Icon name="search" size={18} />
        Search
        <kbd className="font-mono text-[12.5px]">⌘K</kbd>
      </Button>

      {/* ends the session and opens its report */}
      <Button className="h-9 gap-1.5 rounded-lg px-3 text-[14px] font-bold" onClick={() => setReportOpen(true)}>
        <Icon name="flag" size={18} />
        <span className="hidden sm:inline">Conclude session</span>
      </Button>

      <AuthButton />
    </header>
  )
}
