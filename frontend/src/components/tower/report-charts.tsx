"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { agentColor, cap } from "@/lib/format"
import type { SessionReport } from "@/lib/analytics"

// agents are the categorical series: the validated palette, always in this order
const agentConfig = {
  researcher: { label: "Researcher", color: "var(--agent-researcher)" },
  writer: { label: "Writer", color: "var(--agent-writer)" },
  reviewer: { label: "Reviewer", color: "var(--agent-reviewer)" },
  publisher: { label: "Publisher", color: "var(--agent-publisher)" },
} satisfies ChartConfig

const axis = { tickLine: false, axisLine: false, tick: { fontSize: 12.5, fontWeight: 600, fill: "var(--muted-foreground)" } } as const

/** Calls per 30 seconds, stacked by agent: you can see the team hand the work along. */
export function ActivityChart({ data }: { data: SessionReport["charts"]["activity"] }) {
  const agents = Object.keys(agentConfig) as (keyof typeof agentConfig)[]
  return (
    <ChartContainer config={agentConfig} className="aspect-auto h-[260px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap={3}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
        <XAxis dataKey="time" {...axis} tickFormatter={(t: string) => t.slice(0, 5)} interval={3} />
        <YAxis {...axis} allowDecimals={false} width={44} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent labelFormatter={(t) => `From ${t}`} />} />
        <ChartLegend content={<ChartLegendContent />} itemSorter={(item) => agents.indexOf(item.dataKey as keyof typeof agentConfig)} />
        {agents.map((a, i) => (
          <Bar
            key={a}
            dataKey={a}
            stackId="calls"
            fill={`var(--color-${a})`}
            stroke="var(--card)"
            strokeWidth={2}
            radius={i === agents.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive
            animationDuration={700}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

const healthConfig = { health: { label: "Team health", color: "var(--primary)" } } satisfies ChartConfig

/** Share of clean calls after each call; red dots are the calls that raised an issue. */
export function HealthChart({ data }: { data: SessionReport["charts"]["health"] }) {
  return (
    <ChartContainer config={healthConfig} className="aspect-auto h-[260px] w-full">
      <AreaChart data={data} margin={{ top: 12, right: 12, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="health-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-health)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-health)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
        <XAxis dataKey="time" {...axis} tickFormatter={(t: string) => t.slice(0, 5)} interval={3} />
        <YAxis {...axis} domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v: number) => `${v}%`} width={52} />
        <ReferenceLine y={85} stroke="var(--primary)" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "healthy · 85%", position: "insideBottomLeft", fontSize: 12, fontWeight: 700, fill: "var(--primary)" }} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(t) => `After the call at ${t}`} formatter={(v) => [`${v}% clean`, ""]} />} />
        <Area
          dataKey="health"
          type="monotone"
          stroke="var(--color-health)"
          strokeWidth={2.5}
          fill="url(#health-fill)"
          isAnimationActive
          animationDuration={900}
          dot={(p: { cx?: number; cy?: number; payload?: { issue: number | null }; index?: number }) =>
            p.payload?.issue != null && p.cx != null && p.cy != null ? (
              <circle key={p.index} cx={p.cx} cy={p.cy} r={6} fill="var(--flag)" stroke="var(--card)" strokeWidth={2} />
            ) : (
              <g key={p.index} />
            )
          }
          activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}

const freshConfig = {
  fresh: { label: "Latest version", color: "var(--primary)" },
  stale: { label: "Outdated version", color: "var(--flag)" },
} satisfies ChartConfig

/** Reads per agent, split by whether they got the newest version of the fact. */
export function FreshnessChart({ data }: { data: SessionReport["charts"]["freshness"] }) {
  const rows = data.map((d) => ({ ...d, name: cap(d.agent) }))
  return (
    <ChartContainer config={freshConfig} className="aspect-auto h-[230px] w-full">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap={12}>
        <CartesianGrid horizontal={false} strokeDasharray="3 4" stroke="var(--border)" />
        <XAxis type="number" {...axis} allowDecimals={false} domain={[0, "dataMax"]} />
        <YAxis type="category" dataKey="name" {...axis} width={86} tick={{ fontSize: 13.5, fontWeight: 700, fill: "var(--foreground)" }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="fresh" stackId="r" fill="var(--color-fresh)" stroke="var(--card)" strokeWidth={2} radius={[4, 0, 0, 4]} animationDuration={700} />
        <Bar dataKey="stale" stackId="r" fill="var(--color-stale)" stroke="var(--card)" strokeWidth={2} radius={[0, 4, 4, 0]} animationDuration={700} />
      </BarChart>
    </ChartContainer>
  )
}

const timeConfig = { seconds: { label: "Active time" } } satisfies ChartConfig

/** How long each phase was active, in its agent's colour. */
export function PhaseTimeChart({ data }: { data: SessionReport["charts"]["phaseTime"] }) {
  return (
    <ChartContainer config={timeConfig} className="aspect-auto h-[230px] w-full">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 0 }} barCategoryGap={12}>
        <CartesianGrid horizontal={false} strokeDasharray="3 4" stroke="var(--border)" />
        <XAxis type="number" {...axis} ticks={[0, 30, 60, 90, 120]} domain={[0, 120]} tickFormatter={(s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`} />
        <YAxis type="category" dataKey="phase" {...axis} width={86} tick={{ fontSize: 13.5, fontWeight: 700, fill: "var(--foreground)" }} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={<ChartTooltipContent hideIndicator formatter={(v) => [`${Math.floor(Number(v) / 60)}m ${Number(v) % 60}s active`, ""]} />}
        />
        <Bar dataKey="seconds" radius={4} animationDuration={700} label={{ position: "right", fontSize: 12.5, fontWeight: 700, fill: "var(--muted-foreground)", formatter: (v: unknown) => `${Math.floor(Number(v) / 60)}:${String(Number(v) % 60).padStart(2, "0")}` }}>
          {data.map((d) => (
            <Cell key={d.phase} fill={agentColor(d.agent)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** A tiny line for a KPI tile: no axes, just the shape. */
export function Sparkline({ data, dataKey, color }: { data: Record<string, number>[]; dataKey: string; color: string }) {
  return (
    <ChartContainer config={{ [dataKey]: { label: dataKey, color } }} className="aspect-auto h-10 w-full">
      <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
        <Line dataKey={dataKey} type="monotone" stroke={`var(--color-${dataKey})`} strokeWidth={2} dot={false} isAnimationActive animationDuration={900} />
      </LineChart>
    </ChartContainer>
  )
}
