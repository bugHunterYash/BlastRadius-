import { AnimatePresence, motion, useInView } from "framer-motion";
import { Activity, Radar, RefreshCw, Wrench, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Reveal, SectionHead } from "../components/Reveal";

const STEPS = [
  {
    icon: Radar,
    name: "Scan",
    short: "Find",
    body: "The AI reads your docker-compose.yml and your important pages, maps what depends on what, and ranks the failures most likely to hurt you.",
  },
  {
    icon: Zap,
    name: "Break",
    short: "Break",
    body: "It stops or slows one service at a time while realistic traffic keeps flowing. Only containers you labelled as test, with a kill switch and auto-restore.",
  },
  {
    icon: Activity,
    name: "Measure",
    short: "Measure",
    body: "Every second is recorded. A change only counts as damage if it passes a statistical test, so random noise never shows up as a finding.",
  },
  {
    icon: Wrench,
    name: "Fix",
    short: "Fix",
    body: "The AI writes the fix as a code change: a timeout, a fallback, a bigger pool. You review the diff and approve it. Nothing changes without you.",
  },
  {
    icon: RefreshCw,
    name: "Prove",
    short: "Prove",
    body: "The exact same test runs again. You get a before/after report and a new score. If the fix didn't work, it says so.",
  },
];

const R = 150;

export function Loop() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-120px" });

  useEffect(() => {
    if (!inView || paused) return;
    const t = setInterval(() => setActive((a) => (a + 1) % STEPS.length), 2800);
    return () => clearInterval(t);
  }, [inView, paused]);

  const angle = (i: number) => (i / STEPS.length) * Math.PI * 2 - Math.PI / 2;

  return (
    <section id="how" className="mx-auto mt-40 max-w-page scroll-mt-28 px-5">
      <SectionHead
        eyebrow="How it works"
        title={
          <>
            <span className="chrome-text">One loop. Five steps.</span>
            <br />
            <span className="blast-text">Zero guesswork.</span>
          </>
        }
        sub="You ask one question, or none at all. BlastRadius runs the whole loop and shows its work at every step."
      />

      <div ref={ref} className="mt-16 grid items-center gap-14 lg:grid-cols-2">
        <Reveal className="relative mx-auto aspect-square w-full max-w-[440px]">
          <svg viewBox="-200 -200 400 400" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <circle r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 6" />
            <motion.g animate={{ rotate: 360 }} transition={{ duration: 14, repeat: Infinity, ease: "linear" }}>
              <circle cx={0} cy={-R} r={4} fill="#fff" />
              <circle cx={0} cy={-R} r={10} fill="#fff" opacity={0.12} />
            </motion.g>
            {STEPS.map((_, i) => (
              <line
                key={i}
                x1={0}
                y1={0}
                x2={Math.cos(angle(i)) * (R - 36)}
                y2={Math.sin(angle(i)) * (R - 36)}
                stroke={i === active ? "rgba(255,106,61,0.6)" : "rgba(255,255,255,0.06)"}
                strokeWidth={1}
              />
            ))}
          </svg>

          <div className="absolute left-1/2 top-1/2 grid h-36 w-36 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full chrome-border shadow-[0_0_80px_rgba(255,255,255,0.08)]">
            <div className="text-center">
              <div className="text-xs uppercase tracking-[0.18em] text-ink-400">Evidence</div>
              <div className="chrome-text text-xl font-semibold">Engine</div>
            </div>
          </div>

          {STEPS.map((s, i) => {
            const x = 50 + (Math.cos(angle(i)) * R * 100) / 400;
            const y = 50 + (Math.sin(angle(i)) * R * 100) / 400;
            const on = i === active;
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => {
                  setActive(i);
                  setPaused(true);
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${x}%`, top: `${y}%` }}
                aria-pressed={on}
                aria-label={`Step ${i + 1}: ${s.name}`}
              >
                <motion.span
                  animate={{ scale: on ? 1.12 : 1 }}
                  className={`grid h-[74px] w-[74px] place-items-center rounded-full border text-center transition-colors ${
                    on ? "border-blast/60 bg-ink-800 shadow-[0_0_40px_rgba(255,106,61,0.25)]" : "border-white/10 bg-ink-850"
                  }`}
                >
                  <span>
                    <s.icon size={18} className={`mx-auto ${on ? "text-blast" : "text-ink-300"}`} />
                    <span className={`mt-1 block text-[11px] font-semibold ${on ? "text-white" : "text-ink-400"}`}>
                      {s.short}
                    </span>
                  </span>
                </motion.span>
              </button>
            );
          })}
        </Reveal>

        <div className="space-y-2">
          {STEPS.map((s, i) => {
            const on = i === active;
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => {
                  setActive(i);
                  setPaused(true);
                }}
                className={`w-full rounded-2xl border p-5 text-left transition ${
                  on ? "border-white/10 bg-white/[0.04]" : "border-transparent hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className={`font-mono text-sm ${on ? "text-blast" : "text-ink-500"}`}>0{i + 1}</span>
                  <span className={`text-xl font-semibold tracking-tight ${on ? "text-white" : "text-ink-400"}`}>
                    {s.name}
                  </span>
                </div>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.p
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35 }}
                      className="overflow-hidden pl-10 leading-relaxed text-ink-300"
                    >
                      <span className="block pt-2">{s.body}</span>
                    </motion.p>
                  )}
                </AnimatePresence>
                {on && !paused && (
                  <div className="ml-10 mt-4 h-px overflow-hidden bg-white/5">
                    <motion.div
                      key={active}
                      className="h-full bg-blast/70"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 2.8, ease: "linear" }}
                    />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
