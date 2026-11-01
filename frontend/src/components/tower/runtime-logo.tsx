"use client"

import { useId } from "react"
import { cn } from "@/lib/utils"
import { AGENT_META } from "@/lib/data"
import { AgentGlyph } from "./agent-glyph"

/** Small marks for the runtime behind an agent, so "Writer" reads as "Writer, running on Claude Code". */
export function RuntimeMark({ provider, className }: { provider?: string; className?: string }) {
  const gradient = useId()
  if (provider === "claude") {
    // an orange starburst, the shape people recognise as Claude
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <g fill="#D97757">
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x="11" y="2.5" width="2" height="9.5" rx="1" transform={`rotate(${i * 45} 12 12)`} />
          ))}
        </g>
      </svg>
    )
  }
  if (provider === "codex") {
    // a terminal prompt: Codex works in a shell
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <rect x="1.5" y="3" width="21" height="18" rx="4.5" fill="#111" />
        <path d="M7 9l3 3-3 3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.5 15.2h4.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (provider === "antigravity") {
    // an arch lifting off: Antigravity
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <defs>
          <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#4285F4" />
            <stop offset="0.5" stopColor="#9B72CB" />
            <stop offset="1" stopColor="#D96570" />
          </linearGradient>
        </defs>
        <path d="M3.5 20.5C6 20.5 7.6 17 9.2 12.6 10.4 9.2 11 5 12 5s1.6 4.2 2.8 7.6C16.4 17 18 20.5 20.5 20.5" fill="none" stroke={`url(#${gradient})`} strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  return null
}

export const RUNTIME_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", replay: "Replay" }

/** The agent's glyph (its role icon in its colour) with its runtime's logo on the corner. */
export function AgentAvatar({ agent, size = 28, speaking = false }: { agent: string; size?: number; speaking?: boolean }) {
  const provider = AGENT_META[agent]?.provider
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      {speaking && <span className="absolute inset-0 rounded-[30%] border border-cobalt/60 [animation:pulse-ring_1.6s_ease-out_infinite]" />}
      <AgentGlyph agent={agent} size={size} className="relative" />
      {provider && (
        <span className="absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-card p-[2px] shadow-sm" style={{ width: size * 0.55, height: size * 0.55 }}>
          <RuntimeMark provider={provider} className="size-full" />
        </span>
      )}
    </span>
  )
}

/** "Claude Code · claude-sonnet-5-5" style label for an agent, empty when unknown. */
export function runtimeLine(agent: string) {
  const m = AGENT_META[agent]
  if (!m?.provider) return ""
  return [RUNTIME_LABEL[m.provider] ?? m.provider, m.model].filter(Boolean).join(" · ")
}

export function RuntimeChip({ agent, className }: { agent: string; className?: string }) {
  const m = AGENT_META[agent]
  if (!m?.provider) return null
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] text-muted-foreground", className)}>
      <RuntimeMark provider={m.provider} className="size-3" />
      {runtimeLine(agent)}
    </span>
  )
}
