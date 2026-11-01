import { AnimatePresence, motion } from "framer-motion";
import { FileCheck2, GitPullRequest, GraduationCap, History, Rocket } from "lucide-react";
import { useState } from "react";
import { Reveal, SectionHead } from "../components/Reveal";

const CASES = [
  {
    icon: Rocket,
    tab: "Before a big sale",
    who: "Backend dev at an 8-person D2C startup",
    story:
      "Diwali sale is two weeks out. One scan shows checkout slows down at 200 users/sec. The AI traces it to a small database pool, writes the change, and the re-test passes at 10× normal traffic.",
    result: [
      ["Before", "Safe up to 100 users/sec"],
      ["After", "Safe up to 200 users/sec"],
      ["Time spent", "One afternoon"],
    ],
  },
  {
    icon: GraduationCap,
    tab: "Before a demo",
    who: "Student team at a hackathon",
    story:
      "Their app uses Redis for logins. The scan shows login dies with it. A fallback to the database fixes it, and the demo survives the flaky venue Wi-Fi and a crashed container.",
    result: [
      ["Found", "Login depends on redis"],
      ["Fix", "Session fallback, 6 lines"],
      ["Cost", "₹0"],
    ],
  },
  {
    icon: GitPullRequest,
    tab: "On every pull request",
    who: "Tech lead, Team plan",
    story:
      "A GitHub Action runs a short scan on each PR. When a change quietly made checkout depend on Redis, the PR failed with the evidence attached, before it ever reached users.",
    result: [
      ["Check", "blastx scan --ci"],
      ["Result", "PR blocked, evidence linked"],
      ["Outage avoided", "Yes"],
    ],
  },
  {
    icon: FileCheck2,
    tab: "Proof for investors and auditors",
    who: "Founder raising a seed round",
    story:
      "Due diligence asks when disaster recovery was last tested. A shareable report shows what was broken, what failed, how fast it recovered, and the before/after of every fix.",
    result: [
      ["Report", "Link + PDF"],
      ["Covers", "Failures, recovery time, fixes"],
      ["Plan", "Pro"],
    ],
  },
  {
    icon: History,
    tab: "Reproduce an incident",
    who: "On-call engineer after an outage",
    story:
      "Production went down when Redis got slow, not dead. Slowing Redis by 2 seconds in staging reproduces it exactly, so the fix is verified before the postmortem is written.",
    result: [
      ["Fault", "redis +2s latency"],
      ["Reproduced", "Yes, same error pattern"],
      ["Fix verified", "Before/after attached"],
    ],
  },
];

export function UseCases() {
  const [active, setActive] = useState(0);
  const c = CASES[active];

  return (
    <section id="use-cases" className="mx-auto mt-40 max-w-page scroll-mt-28 px-5">
      <SectionHead
        eyebrow="Use cases"
        center
        title={<span className="chrome-text">How teams use BlastRadius</span>}
        sub="Real questions people ask before something goes wrong."
      />
      <Reveal className="mt-14 grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0" role="tablist">
          {CASES.map((x, i) => (
            <button
              key={x.tab}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`relative flex shrink-0 items-center gap-3 rounded-2xl px-5 py-4 text-left transition ${
                i === active ? "text-white" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {i === active && (
                <motion.span
                  layoutId="case-pill"
                  className="absolute inset-0 rounded-2xl border border-white/10 bg-white/[0.05]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              {i === active && (
                <motion.span layoutId="case-bar" className="absolute left-0 top-3 bottom-3 hidden w-[3px] rounded-full bg-blast lg:block" />
              )}
              <x.icon size={18} className="relative" />
              <span className="relative font-medium">{x.tab}</span>
            </button>
          ))}
        </div>

        <div className="glass relative min-h-[380px] overflow-hidden rounded-[28px] p-8 md:p-10" role="tabpanel">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
              transition={{ duration: 0.35 }}
            >
              <div className="text-sm text-ink-400">{c.who}</div>
              <h3 className="mt-2 text-3xl font-semibold tracking-tight text-white">{c.tab}</h3>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-300">{c.story}</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {c.result.map(([k, v]) => (
                  <div key={k} className="rounded-2xl border border-white/[0.07] bg-ink-900/70 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-ink-500">{k}</div>
                    <div className="mt-1.5 font-medium text-white">{v}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </Reveal>
    </section>
  );
}
