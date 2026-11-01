import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { ScoreRing } from "../components/ScoreRing";

// The hero "product shot": a scan that plays on a loop.
// stage 0-3: scan steps running · 4: risks found (score 42) · 5: fixed (score 81)
const STEPS = [
  "Mapping 5 services from docker-compose.yml",
  "Breaking redis safely under 20 users/sec",
  "Ramping traffic 1× → 10× to find the limit",
  "Checking every result for real evidence",
];

const RISKS = [
  {
    sev: "High",
    tone: "bad",
    title: "When the cache (redis) goes down, customers can't add to cart",
    detail: "91% of cart requests fail · p < 0.001",
    cost: "≈ ₹50,000 per 10 min",
    fixed: "Cart now falls back to the database. 0.4% fail.",
  },
  {
    sev: "Medium",
    tone: "warn",
    title: "At 200 users/sec, checkout slows to 0.7s",
    detail: "p95 742 ms vs 500 ms target",
    cost: "Safe up to 100 users/sec",
    fixed: "Connection pool raised. Safe up to 200 users/sec.",
  },
  {
    sev: "Low",
    tone: "muted",
    title: "If the worker crashes, order emails are delayed",
    detail: "No customer-facing errors",
    cost: "No revenue impact",
    fixed: "Unchanged. Recovers on restart in 4s.",
  },
] as const;

const TONE = {
  bad: "bg-bad/10 text-bad border-bad/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  muted: "bg-white/5 text-ink-300 border-white/10",
} as const;

export function HeroScan() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const durations = [1100, 1100, 1100, 1100, 4200, 4600];
    const t = setTimeout(() => setStage((s) => (s + 1) % 6), durations[stage]);
    return () => clearTimeout(t);
  }, [stage]);

  const scanning = stage < 4;
  const fixed = stage === 5;

  return (
    <div className="glass overflow-hidden rounded-[28px]">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-3.5">
        <span className="h-3 w-3 rounded-full bg-white/10" />
        <span className="h-3 w-3 rounded-full bg-white/10" />
        <span className="h-3 w-3 rounded-full bg-white/10" />
        <span className="ml-3 font-mono text-xs text-ink-400">blastx scan · demo-shop</span>
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-2.5 py-0.5 text-[11px] font-semibold text-ok">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" /> LIVE
        </span>
      </div>

      <div className="grid gap-0 md:grid-cols-[300px_1fr]">
        <div className="flex flex-col items-center justify-center gap-4 border-b border-white/[0.07] p-8 md:border-b-0 md:border-r">
          <ScoreRing value={scanning ? 0 : fixed ? 81 : 42} size={170} />
          <AnimatePresence mode="wait">
            <motion.div
              key={scanning ? "scan" : fixed ? "fixed" : "found"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="text-center"
            >
              <div className="text-sm font-semibold text-white">
                {scanning ? "Scanning your app…" : fixed ? "After AI fixes" : "Resilience score"}
              </div>
              <div className="mt-1 text-xs text-ink-400">
                {scanning ? "about 6 minutes on a laptop" : fixed ? "42 → 81 · re-tested, same traffic" : "3 risks found · 2 affect revenue"}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="min-h-[360px] p-6 md:p-8">
          <AnimatePresence mode="wait">
            {scanning ? (
              <motion.ul key="steps" exit={{ opacity: 0 }} className="space-y-4">
                {STEPS.map((s, i) => (
                  <motion.li
                    key={s}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: i <= stage ? 1 : 0.35, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 text-[15px]"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/5">
                      {i < stage ? (
                        <Check size={13} className="text-ok" />
                      ) : i === stage ? (
                        <Loader2 size={13} className="animate-spin text-ink-200" />
                      ) : null}
                    </span>
                    <span className={i <= stage ? "text-ink-100" : "text-ink-500"}>{s}</span>
                  </motion.li>
                ))}
                <li className="pt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-ink-300 to-white"
                      animate={{ width: `${((stage + 1) / 4) * 100}%` }}
                      transition={{ duration: 0.9, ease: "easeOut" }}
                    />
                  </div>
                </li>
              </motion.ul>
            ) : (
              <motion.div key="risks" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">
                    {fixed ? "What changed" : "Top ways your app will fail"}
                  </span>
                  <span className="text-xs text-ink-500">every claim links to evidence</span>
                </div>
                <div className="space-y-3">
                  {RISKS.map((r, i) => (
                    <motion.div
                      key={r.title}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 + i * 0.15, ease: [0.22, 1, 0.36, 1] }}
                      className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 sm:flex-row sm:items-center"
                    >
                      <span
                        className={`w-fit shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          fixed && r.tone !== "muted" ? "border-ok/30 bg-ok/10 text-ok" : TONE[r.tone]
                        }`}
                      >
                        {fixed && r.tone !== "muted" ? "Fixed" : r.sev}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] text-ink-100">{r.title}</div>
                        <div className="mt-0.5 font-mono text-xs text-ink-400">{fixed ? r.fixed : r.detail}</div>
                      </div>
                      {!fixed && <div className="shrink-0 text-sm font-medium text-ink-200">{r.cost}</div>}
                    </motion.div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-950">
                    <Sparkles size={15} /> {fixed ? "View before / after" : "Fix with AI"}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-white/10 px-4 py-2 text-sm text-ink-200">
                    View evidence
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
