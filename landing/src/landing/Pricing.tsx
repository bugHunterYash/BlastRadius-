import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useState } from "react";
import { Reveal, SectionHead } from "../components/Reveal";
import type { Plan } from "../lib/api";

interface Tier {
  plan: Plan;
  name: string;
  forWho: string;
  monthly: number | null;
  unit: string;
  note: string;
  cta: string;
  features: string[];
  hot?: boolean;
}

const TIERS: Tier[] = [
  {
    plan: "free",
    name: "Free",
    forWho: "Students, solo devs, hackathon teams",
    monthly: 0,
    unit: "forever",
    note: "Open source",
    cta: "Install now",
    features: [
      "CLI + local dashboard",
      "Unlimited scans on your machine",
      "Evidence reports",
      "AI agent with your own Gemini key",
    ],
  },
  {
    plan: "pro",
    name: "Pro",
    forWho: "Developers shipping real apps",
    monthly: 699,
    unit: "/ dev / month",
    note: "~ $9",
    cta: "Join waitlist",
    hot: true,
    features: [
      "Everything in Free",
      "Built-in AI, no key needed",
      "Shareable report link + PDF",
      "GitHub Action that blocks risky PRs",
      "Nightly scans + Slack alerts",
    ],
  },
  {
    plan: "team",
    name: "Team",
    forWho: "Startups and product teams",
    monthly: 3999,
    unit: "/ month · 10 devs",
    note: "~ $49",
    cta: "Join waitlist",
    features: [
      "Everything in Pro",
      "Shared workspace + roles",
      "Scan remote staging servers",
      "Compare branches and PRs",
      "Audit log, 1-year history",
    ],
  },
  {
    plan: "enterprise",
    name: "Enterprise",
    forWho: "Companies with compliance needs",
    monthly: null,
    unit: "",
    note: "from ₹2L / year",
    cta: "Talk to us",
    features: [
      "Everything in Team",
      "Self-hosted, on-prem AI",
      "SSO / SAML",
      "DR-test evidence for audits",
      "Priority support",
    ],
  },
];

const inr = (n: number) => n.toLocaleString("en-IN");

export function Pricing({ onChoose }: { onChoose: (plan: Plan) => void }) {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="mx-auto mt-40 max-w-page scroll-mt-28 px-5">
      <SectionHead
        eyebrow="Pricing"
        center
        title={
          <>
            <span className="chrome-text">Free on your laptop.</span>
            <br />
            <span className="chrome-text-soft">Paid when your team needs proof.</span>
          </>
        }
        sub="Tests run on your machine or your CI, not our servers. That's why the local tool can stay free."
      />

      <Reveal className="mt-10 flex justify-center">
        <div className="relative flex rounded-full border border-white/10 bg-ink-850 p-1 text-sm">
          {["Monthly", "Yearly"].map((label, i) => {
            const on = (i === 1) === yearly;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setYearly(i === 1)}
                className={`relative rounded-full px-5 py-2 font-medium transition ${on ? "text-ink-950" : "text-ink-300"}`}
                aria-pressed={on}
              >
                {on && (
                  <motion.span
                    layoutId="billing"
                    className="absolute inset-0 rounded-full bg-white"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative">
                  {label}
                  {i === 1 && <span className={`ml-1.5 text-xs ${on ? "text-ink-600" : "text-ok"}`}>2 months free</span>}
                </span>
              </button>
            );
          })}
        </div>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t, i) => {
          const price = t.monthly === null ? null : yearly ? t.monthly * 10 : t.monthly;
          return (
            <Reveal key={t.plan} delay={i * 0.08}>
              <motion.div
                whileHover={{ y: -6 }}
                transition={{ type: "spring", stiffness: 300, damping: 24 }}
                className={`relative flex h-full flex-col rounded-3xl p-7 ${
                  t.hot
                    ? "chrome-border shadow-[0_30px_90px_-20px_rgba(255,106,61,0.45)]"
                    : "border border-white/10 bg-gradient-to-b from-ink-800 to-ink-850"
                }`}
              >
                {t.hot && (
                  <span className="absolute -top-3 left-7 rounded-full bg-white px-3 py-0.5 text-xs font-semibold text-ink-950">
                    Most popular
                  </span>
                )}
                <div className="text-lg font-semibold text-white">{t.name}</div>
                <div className="mt-1 min-h-[40px] text-sm text-ink-400">{t.forWho}</div>
                <div className="mt-5 flex h-12 items-baseline gap-2">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={price ?? "custom"}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="text-4xl font-semibold tracking-tight text-white"
                    >
                      {price === null ? "Custom" : `₹${inr(price)}`}
                    </motion.span>
                  </AnimatePresence>
                  {price !== null && price > 0 && (
                    <span className="text-sm text-ink-400">{yearly ? t.unit.replace("month", "year") : t.unit}</span>
                  )}
                  {price === 0 && <span className="text-sm text-ink-400">{t.unit}</span>}
                </div>
                <div className="mt-1 text-xs text-ink-500">{t.note}</div>
                <button
                  type="button"
                  onClick={() => onChoose(t.plan)}
                  className={`mt-6 rounded-xl py-2.5 text-sm font-semibold transition ${
                    t.hot ? "bg-white text-ink-950 hover:bg-ink-200" : "border border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]"
                  }`}
                >
                  {t.cta}
                </button>
                <ul className="mt-6 space-y-3">
                  {t.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-sm text-ink-200">
                      <Check size={16} className="mt-0.5 shrink-0 text-ink-400" />
                      {f}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </Reveal>
          );
        })}
      </div>

      <Reveal className="mt-8 flex flex-col items-center justify-center gap-2 text-center text-sm text-ink-400 md:flex-row md:gap-8">
        <span>
          <span className="text-ink-100">Resilience Audit</span> · we test your app before a launch or fundraise · ₹25k–50k one-time
        </span>
        <span>
          <span className="text-ink-100">Education</span> · Pro is free for colleges and hackathons
        </span>
      </Reveal>
    </section>
  );
}
