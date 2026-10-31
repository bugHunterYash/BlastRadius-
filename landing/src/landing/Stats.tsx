import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";
import { Reveal } from "../components/Reveal";

// Facts about the product itself (not usage claims), counted up on view.
const STATS = [
  { value: 1, prefix: "", suffix: "", label: "command to scan your whole app" },
  { value: 5, prefix: "", suffix: "", label: "steps: scan, break, measure, fix, prove" },
  { value: 9, prefix: "", suffix: "", label: "safety checks before anything breaks" },
  { value: 0, prefix: "₹", suffix: "", label: "to start, on your own laptop" },
];

function Counter({ value, prefix }: { value: number; prefix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: "-60px" });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${prefix}${Math.round(v)}`);
  useEffect(() => {
    if (!seen) return;
    const c = animate(mv, value, { duration: 1.6, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [seen, value, mv]);
  return <motion.span ref={ref}>{text}</motion.span>;
}

export function Stats() {
  return (
    <section className="mx-auto mt-28 max-w-page px-5">
      <div className="grid grid-cols-2 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] md:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.08} className="border-white/10 p-8 [&:not(:last-child)]:border-r max-md:[&:nth-child(2)]:border-r-0 max-md:[&:nth-child(-n+2)]:border-b">
            <div className="chrome-text text-5xl font-semibold tracking-tight md:text-6xl">
              <Counter value={s.value} prefix={s.prefix} />
            </div>
            <div className="mt-3 text-sm leading-snug text-ink-300">{s.label}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
