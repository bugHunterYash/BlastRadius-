"use client"

import React from "react"
import { motion } from "motion/react"
import { 
  Binary, 
  TerminalSquare, 
  Lock, 
  Sparkles, 
  FileCheck2, 
  Gauge,
  LucideIcon 
} from "lucide-react"

interface FeatureItem {
  icon: LucideIcon
  tag: string
  title: string
  description: string
  metricBadge?: string
  accentColor: string
}

const FEATURES: FeatureItem[] = [
  {
    icon: Binary,
    tag: "Core Philosophy",
    title: "Predicted vs. Verified Impact",
    description: "The graph shows what could break (from compose config) separately from what actually broke under empirical load. A node only turns red when statistical evidence proves failure.",
    metricBadge: "Zero False Alarms",
    accentColor: "from-blue-500/10 to-indigo-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900/50"
  },
  {
    icon: FileCheck2,
    tag: "Data Integrity",
    title: "Honest Numbers by Contract",
    description: "Missing metrics are explicitly labeled 'unavailable', never zero. Non-live or simulated data is always badged. The agent cannot hallucinate numbers it did not read from a tool.",
    metricBadge: "No Fake Zeros",
    accentColor: "from-emerald-500/10 to-teal-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50"
  },
  {
    icon: Lock,
    tag: "Container Safety",
    title: "Air-Gapped Local Sandbox",
    description: "Operates strictly on labeled test containers (br-test-*). Control plane binds only to 127.0.0.1. Hard caps on load, automatic kill switch, and guaranteed container restore.",
    metricBadge: "100% Safe Teardown",
    accentColor: "from-purple-500/10 to-pink-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900/50"
  },
  {
    icon: Sparkles,
    tag: "Agent Engineering",
    title: "Gemini Agent with Guardrails",
    description: "Plans multi-step chaos experiments through 9 typed tools. It runs nothing without your explicit confirmation, explains root causes with empirical citations, and formulates patches.",
    metricBadge: "9 Typed Tools",
    accentColor: "from-sky-500/10 to-blue-500/10 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-900/50"
  },
  {
    icon: TerminalSquare,
    tag: "Developer Native",
    title: "Paste-Ready for Claude Code & Cursor",
    description: "Every diagnosis generates a paste-ready remediation prompt formatted with exact file paths, line diffs, and context for Claude Code, Cursor, or Aider to apply in seconds.",
    metricBadge: "1-Click Prompt",
    accentColor: "from-amber-500/10 to-orange-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/50"
  },
  {
    icon: Gauge,
    tag: "Efficiency",
    title: "₹0 Stack with Real Capacity Limits",
    description: "Built for CBS 9.0 on a ₹0 budget: runs on free and open-source Docker, PostgreSQL 16, k6 load testing, and Gemini API free tier. Pinpoints exact virtual user breaking limits.",
    metricBadge: "₹0 Budget Stack",
    accentColor: "from-rose-500/10 to-red-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/50"
  }
]

export function FeatureGrid() {
  return (
    <section id="features" className="relative py-16 sm:py-24 px-4 sm:px-6 max-w-6xl mx-auto">
      {/* Section Header */}
      <div className="flex flex-col items-center text-center mb-10 sm:mb-14">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide border bg-white/70 dark:bg-slate-900/70 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 shadow-xs backdrop-blur-md mb-3">
          <span className="material-symbols-rounded text-sm">verified</span>
          <span>Architectural Integrity</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-950 dark:text-white">
          Engineered for honest resilience.
        </h2>
        <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl">
          No vague telemetry. No unverified promises. BlastRadius brings rigor to chaos engineering for small teams and hackathons.
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map((f, i) => {
          const Icon = f.icon
          return (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="group glass-panel rounded-3xl p-6 sm:p-7 flex flex-col justify-between transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-blue-500/10 border-white/80 dark:border-white/10 relative overflow-hidden"
            >
              {/* Subtle top corner gradient tint */}
              <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${f.accentColor} rounded-bl-full opacity-40 group-hover:opacity-70 transition-opacity blur-xl pointer-events-none`} />

              <div>
                {/* Header Icon + Tag */}
                <div className="flex items-center justify-between mb-4">
                  <div className="h-10 w-10 rounded-2xl bg-white dark:bg-slate-800 shadow-md border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center text-slate-900 dark:text-white group-hover:scale-105 transition-transform">
                    <Icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  {f.metricBadge && (
                    <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
                      {f.metricBadge}
                    </span>
                  )}
                </div>

                <div className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
                  {f.tag}
                </div>

                <h3 className="text-lg font-bold text-slate-950 dark:text-white tracking-tight">
                  {f.title}
                </h3>

                <p className="mt-2.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
                  {f.description}
                </p>
              </div>

              {/* Bottom Subtle Pill Highlight */}
              <div className="mt-6 pt-3 border-t border-slate-200/50 dark:border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono">Tested in CBS 9.0</span>
                <span className="material-symbols-rounded text-sm opacity-60 group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
