import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Reveal, SectionHead } from "../components/Reveal";

const QA = [
  {
    q: "Is it safe to break my app on purpose?",
    a: "It only touches containers you labelled as test, refuses anything that looks like production, caps traffic, and restores every service when a run ends, even if BlastRadius itself crashes. There's a kill switch in the terminal and the browser.",
  },
  {
    q: "Do I need Kubernetes?",
    a: "No. If your app runs with docker compose up, BlastRadius can test it. Kubernetes support is on the roadmap for Enterprise.",
  },
  {
    q: "What does the AI actually do?",
    a: "It reads your setup, decides which failures to test first, runs them through typed tools, explains the results in plain language and writes code fixes. It can only quote numbers that came from a real test, and nothing runs or changes without your confirmation.",
  },
  {
    q: "What if the AI is wrong?",
    a: "Every claim links to the measured evidence, and answers that mention a number the tests didn't produce are blocked. Fixes are re-tested with the exact same traffic, so a bad fix shows up as a failed before/after.",
  },
  {
    q: "Does my code or data leave my machine?",
    a: "On Free, tests run locally and results stay local. The AI agent sends summaries of results (not your source tree) to the model you configure. On Pro, only the reports you choose to share are uploaded.",
  },
  {
    q: "How is this different from a load-testing tool?",
    a: "Load tools tell you how fast things are. BlastRadius also breaks dependencies, proves which features failed with statistics, writes the fix and checks it worked.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto mt-40 max-w-page px-5">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
        <SectionHead
          eyebrow="FAQ"
          title={
            <>
              <span className="chrome-text">Questions,</span>
              <br />
              <span className="chrome-text-soft">answered.</span>
            </>
          }
          sub="Still curious? Open an issue on GitHub. We answer every one."
        />
        <Reveal className="space-y-3">
          {QA.map((x, i) => {
            const on = open === i;
            return (
              <div key={x.q} className={`rounded-2xl border transition ${on ? "border-white/15 bg-white/[0.04]" : "border-white/[0.07] bg-ink-850"}`}>
                <button
                  type="button"
                  onClick={() => setOpen(on ? null : i)}
                  aria-expanded={on}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-medium text-white"
                >
                  {x.q}
                  <motion.span animate={{ rotate: on ? 45 : 0 }} className="shrink-0 text-ink-400">
                    <Plus size={18} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-5 leading-relaxed text-ink-300">{x.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
