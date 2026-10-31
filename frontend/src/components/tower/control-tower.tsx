"use client"

import { ReactFlowProvider } from "@xyflow/react"
import { CommandMenu } from "./command-menu"
import { Counters } from "./counters"
import { MemoryGraph } from "./memory-graph"
import { Panel } from "./panel"
import { Legend, ReplayBar } from "./replay-bar"
import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"
import { TowerProvider } from "./tower-store"

export function ControlTower() {
  return (
    <TowerProvider>
      <div className="tower grid h-dvh grid-cols-1 bg-background lg:grid-cols-[232px_minmax(0,1fr)]">
        <Sidebar />
        <div className="grid min-h-0 min-w-0 grid-rows-[52px_minmax(0,1fr)]">
          <TopBar />
          <div className="grid min-h-0 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_440px]">
            <section aria-label="Memory graph" className="relative h-[60vh] min-h-[420px] border-b lg:h-auto lg:border-b-0">
              <ReactFlowProvider>
                <MemoryGraph />
              </ReactFlowProvider>
              <Counters />
              <Legend />
              <ReplayBar />
            </section>
            <Panel />
          </div>
        </div>
      </div>
      <CommandMenu />
    </TowerProvider>
  )
}
