"use client"

import { ArrowLeft } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SharedChat, useVisibleCalls } from "./shared-chat"
import { useTower, type PanelTab } from "./tower-store"
import { AgentView, FactView, IssueView, IssuesView, RunView, RunsView, TraceView } from "./views"

export function Panel() {
  const { state, back, setTab } = useTower()
  const { view } = state
  const calls = useVisibleCalls()

  const content = (() => {
    switch (view.kind) {
      case "run":
        return <RunView id={view.id} />
      case "issues":
        return <IssuesView />
      case "runs":
        return <RunsView />
      case "agent":
        return <AgentView id={view.id} />
      case "fact":
        return <FactView id={view.id} />
      case "issue":
        return <IssueView id={view.id} />
      case "trace":
        return <TraceView id={view.id} />
    }
  })()

  return (
    <aside aria-label="Shared chat and details" className="flex min-h-0 flex-col bg-card lg:border-l">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <Tabs value={state.panelTab} onValueChange={(v) => setTab(v as PanelTab)}>
          <TabsList className="h-8">
            <TabsTrigger value="chat" className="gap-1.5 px-3 text-[13px]">
              Shared chat
              <span className="font-mono text-[11px] text-muted-foreground">{calls.length}</span>
            </TabsTrigger>
            <TabsTrigger value="details" className="px-3 text-[13px]">
              Details
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-mint" />
          {state.mode === "replay" ? "Replay" : "Live"}
        </span>
      </div>

      {state.panelTab === "chat" ? (
        <div className="h-[70vh] min-h-0 flex-1 lg:h-auto">
          <SharedChat />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${view.kind}:${view.id}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="flex flex-col gap-8 px-5 pt-7 pb-10 sm:px-8"
            >
              {state.history.length > 0 && (
                <button
                  type="button"
                  onClick={back}
                  className="-mt-2 -mb-4 -ml-1.5 inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" />
                  Back
                </button>
              )}
              {content}
            </motion.div>
          </AnimatePresence>
        </ScrollArea>
      )}
    </aside>
  )
}
