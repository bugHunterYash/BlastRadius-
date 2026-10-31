import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { agentColor } from "@/lib/format"

/** Each agent's Material Symbol. Together with its colour code, it is how the agent is recognised everywhere. */
export const AGENT_ICON: Record<string, string> = {
  researcher: "travel_explore",
  writer: "edit_note",
  reviewer: "verified",
  publisher: "campaign",
  you: "person",
}

/** The agent's icon on a solid tile in its colour, used in the chat, the sidebar and the details drawer. */
export function AgentGlyph({ agent, size = 28, className }: { agent: string; size?: number; className?: string }) {
  const color = agentColor(agent)
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-[30%] text-white", className)}
      style={{ width: size, height: size, background: color, boxShadow: `0 4px 10px -4px ${color}` }}
      aria-hidden
    >
      <Icon name={AGENT_ICON[agent] ?? "smart_toy"} size={Math.round(size * 0.62)} />
    </span>
  )
}
