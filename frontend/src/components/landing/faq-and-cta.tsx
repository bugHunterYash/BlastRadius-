"use client"

import React, { useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "motion/react"
import { ChevronDown, ArrowRight, ShieldCheck, Sparkles, Terminal } from "lucide-react"

interface FaqItem {
  q: string
  a: string
}

const FAQS: FaqItem[] = [
  {
    q: "Can BlastRadius accidentally damage my host or production containers?",
    a: "No. Safety is guaranteed by design: BlastRadius explicitly refuses any configuration containing production markers (e.g. ENV=production, k8s, AWS tags), binds the control plane strictly to 127.0.0.1, labels all test containers with 'br-test-*', enforces hard CPU/memory cgroups, and executes a guaranteed rollback on any exit or crash."
  },
  {
    q: "How does BlastRadius differ from enterprise tools like Gremlin or Steadybit?",
    a: "Enterprise chaos tools are sold via custom corporate sales quotes, require Kubernetes infrastructure, and only tell you that something broke. BlastRadius is 100% free, runs locally on Docker Compose, connects chaos with synthetic k6 load, and uses Gemini to write the fix and prove it with a before/after re-run."
  },
  {
    q: "What does 'Predicted vs. Verified Impact' mean?",
    a: "Static analysis can only tell you what services depend on each other theoretically (Predicted). BlastRadius runs real synthetic traffic while injecting faults, proving what actually degrades (Verified). A node only turns red when statistical evidence (p < 0.05) confirms failure."
  },
  {
    q: "Does this require a paid Gemini API subscription?",
    a: "No. BlastRadius is purpose-built for the CBS 9.0 Hackathon on a ₹0 budget. It runs seamlessly on the free Gemini 2.5 API tier using concise function calling across 9 typed tools."
  },
  {
    q: "Can I use the fixes with Claude Code, Cursor, or Aider?",
    a: "Yes! Every diagnosis exports a paste-ready prompt formatted specifically for AI coding agents with line-numbered diffs and empirical root-cause context."
  }
]

export function FaqAndCta() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section className="relative py-16 sm:py-24 px-4 sm:px-6 max-w-5xl mx-auto">
      {/* FAQ Section */}
      <div className="flex flex-col items-center text-center mb-10 sm:mb-12">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide border bg-white/70 dark:bg-slate-900/70 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 shadow-xs backdrop-blur-md mb-3">
          <span className="material-symbols-rounded text-sm">help</span>
          <span>Common Questions</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white">
          Frequently Answered
        </h2>
      </div>

      <div className="space-y-3 max-w-3xl mx-auto mb-20 sm:mb-28">
        {FAQS.map((faq, idx) => {
          const isOpen = openIndex === idx
          return (
            <div
              key={idx}
              className="glass-panel rounded-2xl border border-white/80 dark:border-white/10 overflow-hidden transition-all duration-200"
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full px-5 py-4 text-left flex items-center justify-between gap-4 font-semibold text-slate-900 dark:text-white text-sm sm:text-base hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <span>{faq.q}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                    isOpen ? "rotate-180 text-blue-600 dark:text-blue-400" : "text-slate-400"
                  }`}
                />
              </button>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="px-5 pb-5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-200/50 dark:border-slate-800/60 pt-3">
                      {faq.a}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>

      {/* Massive Visual CTA Card (Claude / Antigravity Inspo) */}
      <div className="relative rounded-3xl sm:rounded-4xl p-8 sm:p-14 overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white shadow-2xl border border-slate-800 text-center flex flex-col items-center">
        {/* Ambient background orbs */}
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl flex flex-col items-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide bg-blue-500/20 text-blue-300 border border-blue-400/30 mb-4">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            <span>Ready for Zero-Downtime Releases</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Stop hoping. Start proving.
          </h2>

          <p className="mt-4 text-sm sm:text-base text-slate-300 max-w-xl leading-relaxed">
            Run your first Docker Compose chaos loop in under two minutes. Map dependencies, test under real synthetic traffic, and get proven patches.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full text-sm sm:text-base font-semibold text-slate-950 bg-white hover:bg-slate-100 shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 group"
            >
              <span>Launch Control Tower</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>

            <a
              href="https://github.com/bugHunterYash/BlastRadius-"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto px-6 py-3.5 rounded-full text-xs sm:text-sm font-semibold text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all flex items-center justify-center gap-2"
            >
              <span>Star on GitHub</span>
              <span className="font-mono text-xs opacity-75">★ 142</span>
            </a>
          </div>

          <div className="mt-8 flex items-center gap-4 text-xs text-slate-400 font-mono">
            <span className="flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              100% Deterministic Restore
            </span>
            <span>•</span>
            <span>CBS 9.0 Hackathon Finalist</span>
          </div>
        </div>
      </div>
    </section>
  )
}
