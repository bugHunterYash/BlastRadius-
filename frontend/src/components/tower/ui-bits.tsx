import type { ReactNode } from "react"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { clock, describe } from "@/lib/format"
import type { Issue, IssueStatus, MemoryEvent } from "@/lib/types"

export function Kicker({ children }: { children: ReactNode }) {
  return <div className="mb-2.5 flex items-center gap-2.5 text-[14.5px] text-muted-foreground">{children}</div>
}

export function Title({ children }: { children: ReactNode }) {
  return <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.02em] text-balance">{children}</h1>
}

export function Para({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-3.5 max-w-[60ch] text-[17px] leading-[1.65] text-pretty text-ink-2", className)}>{children}</p>
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 text-[15px] font-bold">{title}</h2>
      {children}
    </section>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[15px] text-muted-foreground">{children}</p>
}

const STATUS: Record<IssueStatus, { label: string; className: string; pulse?: boolean }> = {
  open: { label: "Drafting fix", className: "bg-muted text-ink-2", pulse: true },
  fix_ready: { label: "Needs review", className: "bg-flag-soft text-flag" },
  approved: { label: "Fixed", className: "bg-mint/10 text-mint" },
  rejected: { label: "Dismissed", className: "bg-muted text-muted-foreground" },
  resolved: { label: "Resolved", className: "bg-mint/10 text-mint" },
}

export function StatusPill({ status }: { status: IssueStatus }) {
  const s = STATUS[status]
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold", s.className)}>
      <span className={cn("size-1.5 rounded-full bg-current", s.pulse && "animate-pulse")} />
      {s.label}
    </span>
  )
}

export function Figures({ items }: { items: { value: number | string; label: string; flag?: boolean }[] }) {
  return (
    <div className="grid grid-cols-3 overflow-hidden rounded-xl border bg-border" style={{ gap: 1 }}>
      {items.map((it) => (
        <div key={it.label} className="bg-card px-4 py-3.5">
          <div className={cn("text-[24px] font-bold tracking-[-0.02em] tabular-nums", it.flag && "text-flag")}>{it.value}</div>
          <div className="text-[14px] text-muted-foreground">{it.label}</div>
        </div>
      ))}
    </div>
  )
}

export function IssueCard({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  const open = issue.status === "open" || issue.status === "fix_ready"
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:border-foreground/25"
    >
      <span className={cn("size-2 shrink-0 rounded-full", open ? "bg-flag" : issue.status === "approved" ? "bg-mint" : "bg-border")} />
      <span className="flex-1 truncate text-[15px] font-semibold">{issue.headline}</span>
      <Icon name="chevron_right" size={22} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="-mx-2.5 flex flex-col">{children}</div>
}

export function Row({ lead, children, trail, onClick, chevron = !!onClick }: { lead?: ReactNode; children: ReactNode; trail?: ReactNode; onClick?: () => void; chevron?: boolean }) {
  const body = (
    <>
      {lead}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trail}
      {chevron && <Icon name="chevron_right" size={22} className="text-muted-foreground" />}
    </>
  )
  const cls = "flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[15px]"
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:bg-muted")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function Meta({ children, flag }: { children: ReactNode; flag?: boolean }) {
  return <span className={cn("text-[14.5px] whitespace-nowrap text-muted-foreground tabular-nums", flag && "text-flag")}>{children}</span>
}

export function Timeline({ events, flagged = [], seconds }: { events: MemoryEvent[]; flagged?: string[]; seconds?: boolean }) {
  return (
    <ol className="relative flex flex-col gap-3.5 pl-5 before:absolute before:top-2 before:bottom-2 before:left-[3.5px] before:w-px before:bg-border">
      {events.map((e) => {
        const f = flagged.includes(e.event_id)
        return (
          <li key={e.event_id} className="relative text-[15px] leading-normal">
            <span
              className={cn(
                "absolute top-[7px] -left-5 size-2 rounded-full border-[1.5px]",
                f ? "border-flag bg-flag" : "border-cobalt bg-card",
              )}
            />
            <span className="block font-mono text-[13px] text-muted-foreground">{clock(e.ts, seconds)}</span>
            <span className={cn(f && "font-semibold")}>{describe(e)}</span>
            {e.value_preview && <span className="text-muted-foreground"> · {e.value_preview}</span>}
          </li>
        )
      })}
    </ol>
  )
}
