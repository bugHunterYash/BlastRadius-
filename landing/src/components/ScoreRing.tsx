import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";

// Resilience score dial. Animates from the previous value to `value`.
export function ScoreRing({
  value,
  size = 160,
  label = "Resilience score",
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = useTransform(mv, (v) => c * (1 - v / 100));
  const color = useTransform(mv, [0, 50, 75, 100], ["#f87171", "#fb923c", "#fbbf24", "#4ade80"]);

  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.4, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, mv]);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${value} out of 100`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ strokeDashoffset: offset, stroke: color }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <motion.div
            className="font-semibold leading-none tracking-tight text-white"
            style={{ fontSize: size * 0.3 }}
          >
            {rounded}
          </motion.div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-ink-400">/ 100</div>
        </div>
      </div>
    </div>
  );
}
