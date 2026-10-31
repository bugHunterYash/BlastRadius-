import { useRef, type ReactNode } from "react";

// Card with a soft light that follows the cursor (CSS vars, no re-renders).
export function Spotlight({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--x", `${e.clientX - r.left}px`);
        el.style.setProperty("--y", `${e.clientY - r.top}px`);
      }}
      className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-ink-800 to-ink-850 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition duration-500 hover:-translate-y-1 hover:border-white/20 hover:shadow-[0_30px_70px_-30px_rgba(255,106,61,0.35)] ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(460px circle at var(--x, 50%) var(--y, 0%), rgba(255,140,90,0.14), rgba(255,255,255,0.04) 40%, transparent 65%)",
        }}
      />
      {children}
    </div>
  );
}
