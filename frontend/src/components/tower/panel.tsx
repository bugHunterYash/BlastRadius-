"use client"

import { Icon } from "@/components/ui/icon"
import { AnimatePresence, motion } from "motion/react"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { LiveSessionView } from "./live-sessions"
import { useTower } from "./tower-store"
import { AgentView, FactView, IssueView, IssuesView, RunView, RunsView, TraceView } from "./views"

/** Details for whatever was clicked, sliding over the chat from the right. */
export function DetailsDrawer() {
  const { state, back, setTab, openWorkspace } = useTower()
  const { view } = state

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
      case "live":
        return <LiveSessionView id={view.id} onOpenWorkspace={openWorkspace} onHidden={() => setTab("chat")} />
    }
  })()

  return (
    <Sheet open={state.panelTab === "details"} onOpenChange={(open) => setTab(open ? "details" : "chat")} modal={false}>
      {/* opens over the chat, so the graph stays visible and shows what's selected */}
      <SheetContent side="left" className="top-[52px] h-[calc(100%-52px)]! w-full gap-0 overflow-hidden p-0 sm:max-w-[460px] xl:left-[220px]" onInteractOutside={(e) => e.preventDefault()}>
        <SheetTitle className="sr-only">Details</SheetTitle>
        <SheetDescription className="sr-only">Details for the selected run, agent, fact or issue</SheetDescription>
        {/* only the body scrolls, so the close button (top right) stays in reach */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${view.kind}:${view.id}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="flex flex-col gap-8 px-6 pt-12 pb-10 sm:px-8"
            >
              {state.history.length > 0 && (
                <button
                  type="button"
                  onClick={back}
                  className="-mt-6 -mb-4 -ml-1.5 inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-[14.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Icon name="arrow_back" size={18} />
                  Back
                </button>
              )}
              {content}
            </motion.div>
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  )
}
