"use client"

import { AgentAccess } from "./agent-access"
import { CommandMenu } from "./command-menu"
import { Workspace } from "./graph-panel"
import { DetailsDrawer } from "./panel"
import { NewProject } from "./new-project"
import { ProjectWorkspace } from "./project-workspace"
import { SessionReportView } from "./session-report"
import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"
import { TowerProvider } from "./tower-store"

export function ControlTower() {
  return (
    <TowerProvider>
      <div className="tower grid h-dvh grid-cols-1 bg-background xl:grid-cols-[220px_minmax(0,1fr)]">
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
      <NewProject />
      <AgentAccess />
    </TowerProvider>
  )
}
