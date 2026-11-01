"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { GitFork, Flame, CheckCircle2, Terminal } from "lucide-react"

export function WorkflowStrip() {
  const [activeStep, setActiveStep] = useState<number>(1) // Default to BREAK

  const steps = [
    {
      id: 0,
      num: "01",
      name: "MAP",
      tag: "Topology Discovery",
      title: "Discover Service Dependencies",
      desc: "Parses docker-compose.yml to map ingress, network bridges, and volumes, predicting the theoretical blast radius before touching any container.",
      badge: "bg-sky-500 text-white font-black",
      cardBg: "bg-gradient-to-b from-sky-50/90 to-white dark:from-[#091524] dark:to-[#070b12]",
      activeBorder: "border-sky-500 shadow-[5px_5px_0px_#0284c7] ring-2 ring-sky-400/40",
      inactiveBorder: "border-slate-300 dark:border-neutral-800 shadow-[3px_3px_0px_rgba(0,0,0,0.1)] dark:shadow-[3px_3px_0px_rgba(0,0,0,0.4)]",
      icon: GitFork,
      accentColor: "text-sky-500 dark:text-sky-400",
      widgetPreview: "api-gateway:8000 ──▶ payment:5002 ──▶ redis:6379",
      terminalTitle: "br map --compose docker-compose.yml",
      codePreview: `[BLAST-RADIUS TOPOLOGY ANALYZER]
api-gateway:8000 ──▶ auth-service:4001     [P95: 12ms] [HEALTH: PASS]
api-gateway:8000 ──▶ payment-worker:5002   [TIMEOUT: 5000ms] [CRITICAL_PATH]
payment-worker:5002 ──▶ redis-cache:6379   [ISOLATION: NONE - SYNC BLOCKING]

Theoretical Blast Radius: 3 downstream services impacted if redis-cache degrades.`
    },
    {
      id: 1,
      num: "02",
      name: "BREAK",
      tag: "Chaos Sandbox",
      title: "Inject Faults Under k6 Load",
      desc: "Applies precise latency (+350ms), packet drops, or container kills inside an air-gapped test sandbox while driving real synthetic HTTP traffic with k6.",
      badge: "bg-rose-500 text-white font-black",
      cardBg: "bg-gradient-to-b from-rose-50/90 to-white dark:from-[#200a0d] dark:to-[#090507]",
      activeBorder: "border-rose-500 shadow-[5px_5px_0px_#e11d48] ring-2 ring-rose-400/40",
      inactiveBorder: "border-slate-300 dark:border-neutral-800 shadow-[3px_3px_0px_rgba(0,0,0,0.1)] dark:shadow-[3px_3px_0px_rgba(0,0,0,0.4)]",
      icon: Flame,
      accentColor: "text-rose-500 dark:text-rose-400",
      widgetPreview: "[k6] 300 VUs STRESS ──▶ +350ms LATENCY INJECTED",
      terminalTitle: "br chaos inject --service redis --delay 350ms",
      codePreview: `$ br chaos inject --service redis-cache --delay 350ms --jitter 25ms
$ k6 run --vus 300 --duration 30s checkout_stress.js

[!] SYNTHETIC STRESS TELEMETRY:
    ✓ HTTP requests total: 14,280
    ✗ HTTP 504 timeouts: 2,342 (16.4% dropped)
    ✗ p95 Latency: 485ms (Baseline was 24ms, degradation +1630%)
[!] Anomaly flagged: Payment thread pool saturated.`
    },
    {
      id: 2,
      num: "03",
      name: "PROVE",
      tag: "AI Fix & Proof",
      title: "Automated Before/After Proof",
      desc: "The Gemini agent delivers an evidence-backed patch, re-runs identical 300 VUs stress workloads on the patched sandbox, and proves zero regressions.",
      badge: "bg-emerald-500 text-white font-black",
      cardBg: "bg-gradient-to-b from-emerald-50/90 to-white dark:from-[#081810] dark:to-[#050c08]",
      activeBorder: "border-emerald-500 shadow-[5px_5px_0px_#059669] ring-2 ring-emerald-400/40",
      inactiveBorder: "border-slate-300 dark:border-neutral-800 shadow-[3px_3px_0px_rgba(0,0,0,0.1)] dark:shadow-[3px_3px_0px_rgba(0,0,0,0.4)]",
      icon: CheckCircle2,
      accentColor: "text-emerald-500 dark:text-emerald-400",
      widgetPreview: "p95: 28ms (-94%) • 0.00% DROPS [VERIFIED PROOF]",
      terminalTitle: "br prove --patch docker-compose.override.yml",
      codePreview: `[✓] APPLYING GEMINI REMEDIATION: docker-compose.override.yml
[✓] RE-RUNNING IDENTICAL 300 VUs WORKLOAD ON AIR-GAPPED SANDBOX:
    - Baseline with fault: 485ms p95 ──▶ Patched: 28ms p95 (-94%)
    - Dropped requests: 16.4% ──▶ Patched: 0.00% (eliminated)
    - Circuit breaker: Tripped to safe fallback in 45ms
[✓] VERIFICATION PASSED: Zero regressions detected across 5 health endpoints.`
    }
  ]

  const current = steps[activeStep]

  return (
    <section id="workflow" className="relative py-12 sm:py-20 px-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-900 dark:text-purple-300 font-black text-xs border-2 border-purple-400/40 shadow-xs mb-3">
          <span>The Continuous Reliability Loop</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-black text-slate-950 dark:text-white tracking-tight">
          Three Steps. Zero Guesswork.
        </h2>
        <p className="mt-2 text-sm sm:text-base text-slate-700 dark:text-slate-300 max-w-xl mx-auto font-medium">
          Hover over any card below to instantly preview the live sandbox terminal, simulated chaos, and automated proof.
        </p>
      </div>

      {/* 3 High-Contrast Interactive Cards with Hover Triggers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 mb-6">
        {steps.map((s) => {
          const isSelected = activeStep === s.id
          const Icon = s.icon
          return (
            <motion.div
              key={s.num}
              onMouseEnter={() => setActiveStep(s.id)}
              onClick={() => setActiveStep(s.id)}
              whileHover={{ y: -6, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`p-5 sm:p-6 rounded-2xl cursor-pointer border-2 transition-all duration-300 flex flex-col justify-between relative overflow-hidden select-none ${s.cardBg} ${
                isSelected ? s.activeBorder : s.inactiveBorder
              }`}
            >
              {/* Active Animated Scan Line */}
              {isSelected && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-current to-transparent opacity-80 animate-pulse" />
              )}

              <div>
                <div className="flex items-center justify-between mb-3.5">
                  <span className={`px-2.5 py-0.5 rounded-lg text-xs font-black shadow-xs ${s.badge}`}>
                    {s.num} {s.name}
                  </span>
                  <div className={`h-9 w-9 rounded-xl bg-white dark:bg-neutral-900 border-2 border-current flex items-center justify-center ${s.accentColor} shadow-xs`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>

                <div className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-slate-500 dark:text-neutral-400 mb-1">
                  {s.tag}
                </div>

                <h3 className="text-base sm:text-lg font-black text-slate-950 dark:text-white leading-snug">
                  {s.title}
                </h3>

                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                  {s.desc}
                </p>

                {/* Embedded Mini-Telemetry Widget */}
                <div className="mt-4 px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-black/60 border border-black/10 dark:border-white/10 font-mono text-[10px] text-slate-800 dark:text-neutral-300 truncate">
                  {s.widgetPreview}
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-200 dark:border-neutral-800 flex items-center justify-between text-xs font-bold">
                <span className={isSelected ? `${s.accentColor} font-black` : "text-slate-500 dark:text-neutral-400"}>
                  {isSelected ? "● Live Preview Active" : "Hover to Inspect"}
                </span>
                <span className={`transition-transform duration-300 ${isSelected ? "translate-x-1.5 font-black text-slate-950 dark:text-white" : "text-slate-400"}`}>
                  →
                </span>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Expanded Interactive Mac AMOLED Console for Active Step */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="rounded-2xl bg-black border-2 border-neutral-800 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] overflow-hidden text-neutral-200"
        >
          {/* Mac Terminal Chrome */}
          <div className="px-4 py-3 bg-[#0d0e14] border-b border-neutral-800 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56] inline-block shadow-xs" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e] inline-block shadow-xs" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f] inline-block shadow-xs" />
              <span className="ml-2 font-bold text-white uppercase">Phase {current.num}: {current.name}</span>
              <span className="text-neutral-600">•</span>
              <span className="text-neutral-400 hidden sm:inline">{current.terminalTitle}</span>
            </div>
            <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Isolated Docker Sandbox</span>
            </span>
          </div>

          <pre className="p-5 font-mono text-xs sm:text-sm text-neutral-300 bg-black overflow-x-auto leading-relaxed select-text">
            <code>{current.codePreview}</code>
          </pre>
        </motion.div>
      </AnimatePresence>
    </section>
  )
}
