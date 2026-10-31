import { AnimatePresence, motion, useInView } from "framer-motion";
import { HelpCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Reveal, SectionHead } from "../components/Reveal";

const POINTS = [
  ["You don't pick what to test.", "The scan finds the risky parts of your app on its own."],
  ["Every term is explained.", "Tap any word like cache, p95 or worker to see what it means in one line."],
  ["Ask the way you talk.", "Hinglish or English. The agent answers with links to the evidence."],
];

export function Beginner() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-150px" });
  const [explain, setExplain] = useState(false);
  const [chat, setChat] = useState(0);

  useEffect(() => {
    if (!seen) return;
    const a = setTimeout(() => setExplain(true), 900);
    const b = setTimeout(() => setChat(1), 1900);
    const c = setTimeout(() => setChat(2), 3100);
    return () => [a, b, c].forEach(clearTimeout);
  }, [seen]);

  return (
    <section className="mx-auto mt-40 max-w-page px-5">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <div>
          <SectionHead
            eyebrow="Built for beginners"
            title={
              <>
                <span className="chrome-text">Don't know what Redis is?</span>
                <br />
                <span className="blast-text">You don't need to.</span>
              </>
            }
            sub="Reliability tools usually assume you're an expert. BlastRadius assumes you're busy."
          />
          <div className="mt-10 space-y-6">
            {POINTS.map(([t, b], i) => (
              <Reveal key={t} delay={i * 0.1} className="flex gap-4">
                <span className="mt-1 font-mono text-sm text-blast">0{i + 1}</span>
                <div>
                  <div className="font-semibold text-white">{t}</div>
                  <div className="mt-1 text-ink-300">{b}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal>
          <div ref={ref} className="glass space-y-4 rounded-[28px] p-6">
            <div className="rounded-2xl border border-white/[0.07] bg-ink-900 p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-bad">
                <span className="h-2 w-2 rounded-full bg-bad" /> HIGH RISK
              </div>
              <p className="mt-2 text-[17px] text-white">
                If the{" "}
                <button
                  type="button"
                  onClick={() => setExplain((e) => !e)}
                  className="inline-flex items-center gap-1 rounded-md border-b border-dashed border-ink-400 text-white"
                  aria-expanded={explain}
                >
                  cache <HelpCircle size={13} className="text-ink-400" />
                </button>{" "}
                goes down, customers can't add items to their cart.
              </p>
              <AnimatePresence>
                {explain && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-relaxed text-ink-200">
                      <span className="font-semibold text-white">Cache (redis):</span> your app's short-term memory.
                      It keeps things like carts and logins close by so pages load fast. If it's gone and the app
                      has no backup plan, those features stop working.
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/[0.07] bg-ink-900 p-5">
              <AnimatePresence>
                {chat >= 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-white px-4 py-2.5 text-sm text-ink-950"
                  >
                    checkout kyun slow hua?
                  </motion.div>
                )}
                {chat >= 2 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-fit max-w-[92%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-ink-200"
                  >
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-400">
                      <Sparkles size={12} className="text-blast" /> BlastRadius agent
                    </div>
                    200 users/sec par database ke connections khatam ho gaye. Checkout ko connection ke liye wait
                    karna pada, isliye p95 742ms tak gaya{" "}
                    <span className="rounded bg-white/10 px-1.5 font-mono text-xs text-ink-100">E2</span>. Pool
                    size 10 se 30 karne ka patch ready hai.
                  </motion.div>
                )}
              </AnimatePresence>
              {chat < 1 && <div className="h-24" />}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
