import { cn } from "@/lib/utils"

/**
 * A Google Material Symbol (rounded). `name` is the symbol's ligature, e.g. "search" or "send";
 * the full list is at fonts.google.com/icons.
 */
export function Icon({ name, size = 20, fill = true, weight = 500, className, style }: { name: string; size?: number; fill?: boolean; weight?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn("material-symbols-rounded shrink-0 select-none", className)}
      style={{ fontSize: size, width: size, height: size, fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${Math.min(48, Math.max(20, size))}`, ...style }}
    >
      {name}
    </span>
  )
}
