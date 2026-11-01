"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Terminal, Copy, Check, Sparkles, ChevronRight, Play } from "lucide-react"

interface CliTab {
  id: string
  title: string
  command: string
  output: string[]
}

const CLI_TABS: CliTab[] = [
  {
    id: "run",
    title: "br run",
    command: "br run --compose docker-compose.yml --vus 250 --duration 30s",
    output: [
      "[1/5] MAP: Discovered 5 services from docker-compose.yml",
      "[2/5] SANDBOX: Provisioned 5 isolated test containers (br-test-*) on 127.0.0.1",
      "[3/5] LOAD: Spinning up 250 synthetic virtual users via k6 engine...",
      "[4/5] MEASURE: p95=34ms, errors=0.0%, throughput=812 req/s",
      "[✓] Baseline run certified. System healthy under target concurrency."
    ]
  },
  {
    id: "chaos",
    title: "br chaos",
    command: "br chaos inject --service redis-cache --latency 300ms --packet-drop 5%",
    output: [
      "[!] INJECTING CHAOS: Added 300ms netem delay on interface eth0 of redis-cache",
      "[*] Monitoring downstream blast radius: payment-worker latency increased to 380ms",
      "[!] ALERT: payment-worker connection pool exhausted (30/30 threads saturated)",
      "[*] API Gateway returned 504 Gateway Timeout for 14.8% of checkout calls",
      "[✓] Fault recorded with statistical significance p=0.00021."
    ]
  },
  {
    id: "ask",
    title: "br ask (Gemini Agent)",
    command: "br ask \"Why did payment-worker cascade when Redis had latency?\"",
    output: [
      "Gemini Reliability Agent analyzing empirical execution logs...",
      "> Root cause: payment-worker has synchronous redis.get() calls with default 10s timeout.",
      "> Under 250 VUs, requests queued faster than threads could clear, starving HTTP pool.",
      "> Fix: Configure 400ms circuit-breaker timeout + exponential backoff with max 2 retries.",
      "> Patch written to ./docker-compose.override.yml. Run 'br prove' to verify."
    ]
  },
  {
    id: "prove",
    title: "br prove",
    command: "br prove --patch docker-compose.override.yml --compare",
    output: [
      "[*] Applying patch to sandboxed containers...",
      "[*] Re-executing identical 250 VU synthetic workload...",
      "[✓] PROVE SUCCESSFUL:",
      "    - p95 Latency: 485ms -> 34ms (-93.0% delta)",
      "    - Error Rate: 14.8% -> 0.00% (eliminated)",
      "    - Rollback State: Cleanly restored to original containers."
    ]
  }
]

export function CliTerminal() {
  const [activeTabId, setActiveTabId] = useState("run")
  const [copied, setCopied] = useState(false)

  const activeTab = CLI_TABS.find(t => t.id === activeTabId)!

  const handleCopy = () => {
    navigator.clipboard.writeText(activeTab.command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section id="terminal" className="relative py-16 sm:py-24 px-4 sm:px-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col items-center text-center mb-10 sm:mb-14">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide border bg-white/70 dark:bg-slate-900/70 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 shadow-xs backdrop-blur-md mb-3">
          <span className="material-symbols-rounded text-sm">terminal</span>
          <span>Developer Native CLI</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-950 dark:text-white">
          Terminal-first. CI/CD ready.
        </h2>
        <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl">
          Everything accessible in the Control Tower is equally powerful in your shell with the <code className="font-mono text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">br</code> CLI.
        </p>
      </div>

      {/* Terminal Window Box */}
      <div className="max-w-4xl mx-auto rounded-3xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Terminal Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-500/80" />
            <span className="h-3 w-3 rounded-full bg-amber-500/80" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
            <span className="ml-3 text-xs font-mono text-slate-400 hidden sm:inline">blastradius-cli ~ v1.0.0</span>
          </div>

          {/* Sub-tabs */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {CLI_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                  activeTabId === tab.id
                    ? "bg-blue-600 text-white font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab.title}
              </button>
            ))}
          </div>

          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Copy Command"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        {/* Terminal Body */}
        <div className="p-5 sm:p-7 font-mono text-xs sm:text-sm text-slate-200 min-h-[260px] flex flex-col justify-between">
          <div>
            {/* Input line */}
            <div className="flex items-center gap-2 text-slate-100 pb-3 border-b border-slate-800/80">
              <span className="text-emerald-400 font-bold">harshit@blastradius:~$</span>
              <span className="text-white font-semibold flex-1 overflow-x-auto">{activeTab.command}</span>
            </div>

            {/* Output lines with animated typewriter feel */}
            <div className="mt-4 space-y-2">
              {activeTab.output.map((line, idx) => {
                const isCheck = line.startsWith("[✓]")
                const isAlert = line.startsWith("[!]")
                const isAgent = line.startsWith("Gemini") || line.startsWith(">")
                return (
                  <motion.div
                    key={`${activeTab.id}-${idx}`}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: idx * 0.06 }}
                    className={`leading-relaxed text-xs sm:text-sm ${
                      isCheck
                        ? "text-emerald-400 font-semibold"
                        : isAlert
                        ? "text-rose-400 font-medium"
                        : isAgent
                        ? "text-blue-300"
                        : "text-slate-300"
                    }`}
                  >
                    {line}
                  </motion.div>
                )
              })}
            </div>
          </div>

          {/* Prompt Ready */}
          <div className="mt-6 flex items-center gap-2 text-slate-500 text-xs">
            <span className="text-emerald-400 font-bold">harshit@blastradius:~$</span>
            <span className="inline-block h-4 w-2 bg-blue-400 animate-pulse" />
          </div>
        </div>
      </div>
    </section>
  )
}
