"use client"

import React, { useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "motion/react"
import {
  ArrowRight,
  Check,
  Copy,
  DownloadCloud,
  Play,
  ShieldCheck,
  Zap,
  Terminal,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from "lucide-react"

export function Quickstart() {
  const [activePhase, setActivePhase] = useState<number>(0)
  const [copied, setCopied] = useState<boolean>(false)

  const steps = [
    {
      id: 0,
      num: "01",
      badge: "INSTALL",
      title: "One-Line Binary Install",
      subtitle: "Instant local CLI",
      desc: "Zero dependencies. Precompiled static binary for Linux & macOS.",
      cmd: "curl -sSL https://blastradius.dev/install | sh",
      icon: DownloadCloud,
      color: "cyan",
      badgeClass: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-400/40",
      activeRing: "border-cyan-500 shadow-[0_12px_30px_rgba(6,182,212,0.25)] ring-2 ring-cyan-400/30",
      terminalHeader: "zsh — blastradius-installer",
      logs: [
        { text: "$ curl -sSL https://blastradius.dev/install | sh", type: "cmd" },
        { text: "⚡ Verifying target architecture: Linux x86_64", type: "info" },
        { text: "✔ Integrity Checksum SHA-256: 9f84b3e... [VERIFIED]", type: "success" },
        { text: "✔ Downloaded binary: 48.2 MB in 0.3s [████████████████] 100%", type: "success" },
        { text: "✔ Symlinked: /usr/local/bin/br -> v1.0.4", type: "success" },
        { text: "✨ BlastRadius is ready! Run `br --help` to explore.", type: "highlight" },
      ],
      metrics: [
        { label: "Install Time", val: "0.6s" },
        { label: "Binary Size", val: "48.2 MB" },
        { label: "Dependencies", val: "0 (Zero)" },
      ],
    },
    {
      id: 1,
      num: "02",
      badge: "SIMULATE",
      title: "Run Air-Gapped Chaos",
      subtitle: "Synthetic k6 Traffic",
      desc: "Auto-discovers compose topology and injects targeted network latency.",
      cmd: "br run --compose docker-compose.yml",
      icon: Play,
      color: "rose",
      badgeClass: "bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-400/40",
      activeRing: "border-rose-500 shadow-[0_12px_30px_rgba(244,63,94,0.25)] ring-2 ring-rose-400/30",
      terminalHeader: "zsh — br run (chaos engine)",
      logs: [
        { text: "$ br run --compose docker-compose.yml", type: "cmd" },
        { text: "🔍 Auto-discovered 3 services: web (Go), auth (Node), redis (Alpine)", type: "info" },
        { text: "🧪 Spawning k6 runner: 300 virtual users targeting /api/v1/checkout", type: "info" },
        { text: "⚡ Injecting fault: 250ms packet latency + 15% drop on [redis]", type: "warn" },
        { text: "💥 Bottleneck captured: Redis pool exhaustion (p99: 4,820ms)", type: "error" },
        { text: "💾 Snapshot archived: memory dump & network traces saved to .br/reports", type: "highlight" },
      ],
      metrics: [
        { label: "Synthetic VUs", val: "300 VUs" },
        { label: "Fault Type", val: "Latency + Drop" },
        { label: "Impact", val: "p99: 4,820ms" },
      ],
    },
    {
      id: 2,
      num: "03",
      badge: "PROVE",
      title: "Prove Resilient Patches",
      subtitle: "Verified by Gemini AI",
      desc: "Synthesizes config fixes and re-runs chaos to prove zero regressions.",
      cmd: "br prove --patch docker-compose.override.yml",
      icon: ShieldCheck,
      color: "emerald",
      badgeClass: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-400/40",
      activeRing: "border-emerald-500 shadow-[0_12px_30px_rgba(16,185,129,0.25)] ring-2 ring-emerald-400/30",
      terminalHeader: "zsh — br prove (ai synthesizer)",
      logs: [
        { text: "$ br prove --patch docker-compose.override.yml", type: "cmd" },
        { text: "🤖 Gemini 1.5 Flash: analyzing redis timeout logs...", type: "info" },
        { text: "💡 Patch generated: docker-compose.override.yml (+12 lines)", type: "highlight" },
        { text: "   + healthcheck: interval: 2s, timeout: 500ms, retries: 3", type: "diff-add" },
        { text: "   + deploy.restart_policy: condition: on-failure", type: "diff-add" },
        { text: "🔄 Re-testing against chaos traffic (300 k6 VUs)...", type: "info" },
        { text: "🎉 Proof Verified: 0 dropped packets, p99 latency 4,820ms -> 34ms", type: "success" },
      ],
      metrics: [
        { label: "Gemini Model", val: "1.5 Flash" },
        { label: "Latency Drop", val: "-99.3%" },
        { label: "Verdict", val: "PROVED SAFE" },
      ],
    },
  ]

  const currentStep = steps[activePhase]

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="relative py-16 px-4 max-w-5xl mx-auto">
      {/* Outer Glow & Glassmorphism Backdrop */}
      <div className="relative rounded-3xl bg-white/70 dark:bg-[#070912]/80 backdrop-blur-2xl border border-slate-300/80 dark:border-white/10 shadow-[0_24px_70px_-15px_rgba(0,0,0,0.1)] dark:shadow-[0_24px_70px_-15px_rgba(0,0,0,0.8)] p-6 sm:p-10 overflow-hidden">
        
        {/* Subtle Ambient Radial Highlight */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-purple-500/10 dark:bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-emerald-500/10 dark:bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header Row */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 pb-8 border-b border-slate-200/80 dark:border-white/10 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/5 dark:bg-white/10 text-slate-900 dark:text-white text-xs font-black border border-slate-300/70 dark:border-white/15 shadow-xs mb-3">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
              </span>
              <span>Autonomous Reliability Pipeline</span>
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-black text-slate-950 dark:text-white tracking-tight">
              Test Your Services in 60 Seconds
            </h2>
            
            <p className="mt-1.5 text-sm sm:text-base text-slate-600 dark:text-slate-400 font-medium">
              Runs 100% locally on <span className="font-mono font-bold text-slate-900 dark:text-slate-200">127.0.0.1</span> inside an isolated sandbox container.
            </p>
          </div>

          {/* High-Contrast "TRY IT" Action (Matches Navbar & Hero theme) */}
          <Link
            href="/tower"
            className="px-6 py-3 rounded-full bg-slate-950 hover:bg-slate-800 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-slate-950/20 dark:shadow-emerald-500/30 hover:scale-[1.03] active:scale-[0.98] transition-all cursor-pointer shrink-0 border border-slate-800 dark:border-emerald-300"
          >
            <Zap className="h-3.5 w-3.5 fill-current text-amber-400 dark:text-slate-950" />
            <span>TRY IT</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* 3 Step Interactive Pipeline Steppers */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3.5 relative z-10">
          {steps.map((s) => {
            const Icon = s.icon
            const isActive = activePhase === s.id

            return (
              <div
                key={s.id}
                onClick={() => setActivePhase(s.id)}
                className={`p-4 sm:p-5 rounded-2xl border transition-all duration-200 cursor-pointer select-none flex flex-col justify-between group ${
                  isActive
                    ? `bg-white dark:bg-[#0c101a] ${s.activeRing} -translate-y-1`
                    : "bg-slate-100/60 dark:bg-[#080b12]/60 border-slate-200/80 dark:border-white/10 opacity-70 hover:opacity-100 hover:border-slate-300 dark:hover:border-white/20"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black border ${s.badgeClass}`}>
                      PHASE {s.num} • {s.badge}
                    </span>
                    <div
                      className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-transform group-hover:scale-110 ${
                        isActive
                          ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950 border-transparent shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                  </div>

                  <h3 className="text-sm font-extrabold text-slate-950 dark:text-white leading-tight">
                    {s.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                    {s.desc}
                  </p>
                </div>

                {/* Micro Command Snippet with Copy */}
                <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-white/10 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] font-bold text-slate-700 dark:text-slate-300 truncate">
                    {s.cmd}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-slate-400 group-hover:text-purple-600 dark:group-hover:text-cyan-400 transition-colors shrink-0">
                    CLICK TO VIEW →
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Live Interactive Terminal & Telemetry Stage */}
        <div className="mt-6 rounded-2xl bg-[#090d16] border border-slate-800 text-white shadow-2xl overflow-hidden relative z-10">
          
          {/* Terminal Top Window Bar */}
          <div className="px-4 py-3 bg-[#0d121e] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 select-none">
            {/* Real Traffic Lights */}
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors inline-block" />
              <span className="h-3 w-3 rounded-full bg-amber-500/80 hover:bg-amber-500 transition-colors inline-block" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500 transition-colors inline-block" />
              <span className="ml-2 font-mono text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-purple-400" />
                <span>{currentStep.terminalHeader}</span>
              </span>
            </div>

            {/* Quick Copy Command Capsule */}
            <button
              onClick={() => handleCopy(currentStep.cmd)}
              className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-mono font-bold text-slate-200 hover:text-white transition-all cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-300">COPIED</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-400" />
                  <span>COPY COMMAND</span>
                </>
              )}
            </button>
          </div>

          {/* Terminal Body with Smooth Fade Animation */}
          <div className="p-5 sm:p-6 font-mono text-xs sm:text-[13px] leading-relaxed overflow-x-auto min-h-[190px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="space-y-1.5"
              >
                {currentStep.logs.map((log, index) => {
                  let style = "text-slate-300"
                  if (log.type === "cmd") style = "text-cyan-400 font-bold"
                  if (log.type === "success") style = "text-emerald-400 font-medium"
                  if (log.type === "warn") style = "text-amber-400 font-medium"
                  if (log.type === "error") style = "text-rose-400 font-semibold"
                  if (log.type === "highlight") style = "text-purple-300 font-bold"
                  if (log.type === "diff-add") style = "text-emerald-300 font-mono pl-3"

                  return (
                    <div key={index} className={style}>
                      {log.text}
                    </div>
                  )
                })}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Terminal Bottom Telemetry Bar */}
          <div className="px-5 py-2.5 bg-[#070a12] border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            <div className="flex items-center gap-4 text-slate-400">
              {currentStep.metrics.map((m, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="text-slate-500">{m.label}:</span>
                  <span className="text-slate-200 font-bold">{m.val}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>local-daemon (127.0.0.1:9090)</span>
            </div>
          </div>
        </div>

        {/* Bottom Trust Grid Badges */}
        <div className="mt-8 pt-5 border-t border-slate-200/80 dark:border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-bold text-slate-700 dark:text-slate-300 select-none">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>Air-Gapped Sandbox</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>Zero Cloud Secrets</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>Powered by Gemini</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>Docker Native Engine</span>
          </div>
        </div>

      </div>
    </section>
  )
}
