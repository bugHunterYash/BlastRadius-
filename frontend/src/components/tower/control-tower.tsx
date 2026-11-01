"use client"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { AgentAccess } from "./agent-access"
import { FolderAccess } from "./folder-access"
import { CommandMenu } from "./command-menu"
import { Workspace } from "./graph-panel"
import { DetailsDrawer } from "./panel"
import { NewProject } from "./new-project"
import { ProjectWorkspace } from "./project-workspace"
import { SessionReportView } from "./session-report"
import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"
import { TowerProvider, useTower } from "./tower-store"
import { UserContext, type SignedInUser } from "./user-menu"

export function ControlTower({ user = null }: { user?: SignedInUser | null }) {
  return (
    <UserContext.Provider value={user}>
      <TowerProvider>
        <Screen />
        <NewProject />
        <AgentAccess />
        <FolderAccess />
      </TowerProvider>
    </UserContext.Provider>
  )
}

/** Only real data: until a run loads from the backend, say what's happening instead of showing a sample. */
function Screen() {
  const { state } = useTower()
  if (state.source !== "live") return <Waiting />
  return (
    <>
      <div className="tower grid h-dvh grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-background xl:grid-cols-[220px_minmax(0,1fr)]">
        <Sidebar />
        <div className="grid min-h-0 min-w-0 grid-rows-[52px_minmax(0,1fr)]">
          <TopBar />
          <Workspace />
        </div>
      </div>
      <DetailsDrawer />
      <CommandMenu />
      <SessionReportView />
      <ProjectWorkspace />
    </>
  )
}

function Waiting() {
  const { state, setNewProjectOpen, setAccessOpen, setFoldersOpen } = useTower()
  const copy = {
    connecting: { icon: "progress_activity", title: "Connecting to the Control Tower", body: "Loading your agents’ runs from the backend…" },
    offline: { icon: "cloud_off", title: "The backend isn’t reachable", body: "Start the tower API (port 8010), then try again. Nothing is shown until real data loads." },
    empty: { icon: "rocket_launch", title: "No runs yet", body: "Start a project and give each agent its part. Its run, memory graph and report show up here." },
    ok: { icon: "progress_activity", title: "Loading", body: "" },
  }[state.backend]
  return (
    <div className="tower grid h-dvh place-items-center bg-background p-6">
      <div className="max-w-[440px] text-center">
        <Icon name={copy.icon} size={36} className={state.backend === "connecting" ? "animate-spin text-muted-foreground" : "text-muted-foreground"} />
        <h1 className="mt-3 text-[22px] font-bold">{copy.title}</h1>
        <p className="mt-2 text-[14.5px] text-muted-foreground">{copy.body}</p>
        <div className="mt-5 flex justify-center gap-2">
          {state.backend === "offline" && <Button onClick={() => window.location.reload()}>Try again</Button>}
          {state.backend === "empty" && (
            <>
              <Button className="bg-cobalt text-white hover:bg-cobalt/90" onClick={() => setNewProjectOpen(true)}>New project</Button>
              <Button variant="outline" onClick={() => setAccessOpen(true)}>Connect agents</Button>
              <Button variant="outline" onClick={() => setFoldersOpen(true)}>Allow folders</Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
