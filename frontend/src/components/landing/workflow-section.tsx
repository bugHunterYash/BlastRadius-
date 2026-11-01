"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { 
  GitFork, 
  Flame, 
  BarChart3, 
  Wand2, 
  CheckCircle, 
  ArrowRight,
  Code2,
  Terminal,
  ShieldCheck,
  Zap,
  Activity,
  Layers
} from "lucide-react"

interface WorkflowStep {
  id: string
  num: string
  title: string
  subtitle: string
  tagline: string
  question: string
  description: string
  highlights: string[]
  previewType: "graph" | "break" | "measure" | "fix" | "prove"
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: "map",
    num: "01",
    title: "MAP",
    subtitle: "Compose Graph & Blast Radius",
    tagline: "Topological Dependency Parsing",
    question: "What could break?",
    description: "BlastRadius parses your docker-compose.yml files, discovers services, environment links, volumes, and ports, and calculates the theoretical blast radius before touching any container.",
    highlights: [
      "Predicted vs Verified: Highlights theoretical dependencies vs measured reality",
      "Network isolation checks and health check audit",
      "Calculates service centrality and single points of failure"
    ],
    previewType: "graph"
  },
  {
    id: "break",
    num: "02",
    title: "BREAK",
    subtitle: "Sandboxed Chaos & k6 Load",
    tagline: "Controlled Fault Injection",
    question: "What did break?",
    description: "Applies precise faults—latency, packet drop, CPU throttling, or OOM container kill—inside an air-gapped test sandbox while driving real synthetic k6 HTTP traffic against your endpoints.",
    highlights: [
      "Safe by design: only allowlisted, labelled test containers",
      "Hard caps on virtual users (VUs) and memory consumption",
      "Kill switch everywhere with guaranteed restore"
    ],
    previewType: "break"
  },
  {
    id: "measure",
    num: "03",
    title: "MEASURE",
    subtitle: "Statistical Evidence Report",
    tagline: "Honest Numbers by Contract",
    question: "How bad, how long, why?",
    description: "Records latency distributions (p50, p95, p99), error rates, throughput loss, and mean-time-to-recovery (MTTR). Non-live data is clearly badged, and missing metrics are labelled 'unavailable', never zero.",
    highlights: [
      "No fake data fallback: missing metrics are marked 'unavailable', never zero",
      "Statistical p-value significance tests to separate noise from failure",
      "Real-time SSE event stream for live dashboard observation"
    ],
    previewType: "measure"
  },
  {
    id: "fix",
    num: "04",
    title: "FIX",
    subtitle: "AI Fix Prompt & Unified Patch",
    tagline: "Gemini 2.5 Remediation Agent",
    question: "What to change?",
    description: "The Gemini agent plans experiments, queries telemetry through 9 typed function-calling tools, explains root causes with empirical citations, and generates paste-ready patches for Cursor, Claude Code, or Aider.",
    highlights: [
      "Grounding check: AI cannot invent numbers it didn't read from a tool",
      "Paste-ready prompt export formatted for AI coding agents",
      "Minimal diffs: timeouts, retries, circuit breakers, pool limits"
    ],
    previewType: "fix"
  },
  {
    id: "prove",
    num: "05",
    title: "PROVE",
    subtitle: "Before vs After Re-Run Verification",
    tagline: "Empirical Proof of Fix",
    question: "Did it work?",
    description: "A fix isn't complete until proven. BlastRadius re-executes the exact same synthetic workload against the patched container sandbox to prove the fix eliminated the vulnerability without regressions.",
    highlights: [
      "Deterministic verification under identical traffic patterns",
      "Side-by-side delta report showing latency drop and error elimination",
      "One-click audit trail exported as JSON and PDF"
    ],
    previewType: "prove"
  }
]

export function WorkflowSection() {
  const [activeStepId, setActiveStepId] = useState("map")
  const activeStep = WORKFLOW_STEPS.find(s => s.id === activeStepId)!

  return (
    <section id="workflow" className="relative py-16 sm:py-24 px-4 sm:px-6 max-w-6xl mx-auto">
      {/* Section Header */}
      <div className="flex flex-col items-center text-center mb-10 sm:mb-14">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide border bg-white/70 dark:bg-slate-900/70 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 shadow-xs backdrop-blur-md mb-3">
          <span className="material-symbols-rounded text-sm">cycle</span>
          <span>The BlastRadius Workflow</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-950 dark:text-white">
          Five steps. Zero guesswork.
        </h2>
        <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl">
          Engineered like Antigravity and Claude: a continuous, transparent feedback loop where every step produces verifiable data and actionable code.
        </p>
      </div>

      {/* Floating Pill Workflow Navigation Tabs */}
      <div className="flex items-center justify-start sm:justify-center overflow-x-auto pb-4 gap-2 no-scrollbar">
        {WORKFLOW_STEPS.map((step) => {
          const isActive = activeStepId === step.id
          return (
            <button
              key={step.id}
              onClick={() => setActiveStepId(step.id)}
              className={`relative px-4 sm:px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${
                isActive
                  ? "bg-slate-900 text-white dark:bg-blue-600 shadow-md scale-[1.02]"
                  : "glass-pill text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white"
              }`}
            >
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                isActive ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-500"
              }`}>
                {step.num}
              </span>
              <span>{step.title}</span>
              <span className="hidden md:inline text-xs opacity-70 font-normal">({step.question})</span>
            </button>
          )
        })}
      </div>

      {/* Active Workflow Stage Card Showcase */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeStep.id}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -15 }}
          transition={{ duration: 0.3 }}
          className="mt-8 glass-panel rounded-3xl p-6 sm:p-10 shadow-xl border-white/80 dark:border-white/10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center"
        >
          {/* Left Column: Context & Bullet Points */}
          <div className="lg:col-span-5 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                Stage {activeStep.num} • {activeStep.tagline}
              </span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight">
              {activeStep.subtitle}
            </h3>
            <div className="inline-block mt-1 text-xs font-semibold px-2.5 py-1 rounded-md bg-blue-100/70 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 w-fit">
              Key Question: &quot;{activeStep.question}&quot;
            </div>

            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {activeStep.description}
            </p>

            <ul className="mt-6 space-y-2.5">
              {activeStep.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <div className="h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle className="h-3 w-3" />
                  </div>
                  <span>{h}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 pt-4 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center gap-3">
              <a
                href="#simulator"
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 group"
              >
                <span>Test in Live Simulator</span>
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          </div>

          {/* Right Column: Interactive UI Visual Representation */}
          <div className="lg:col-span-7 rounded-2xl bg-slate-950 p-4 sm:p-6 text-white border border-slate-800 shadow-2xl overflow-hidden min-h-[320px] flex flex-col justify-between">
            {/* Window Topbar */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs text-slate-400 font-mono">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                <span className="ml-2 text-slate-300">blastradius --stage {activeStep.id}</span>
              </div>
              <span className="text-[11px] text-blue-400">100% Deterministic</span>
            </div>

            {/* Dynamic Stage Render */}
            <div className="py-4 font-mono text-xs text-slate-300">
              {activeStep.id === "map" && (
                <div className="space-y-3">
                  <div className="text-emerald-400">✓ Parsed docker-compose.yml (5 services, 3 networks)</div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] space-y-1">
                    <div className="text-blue-300 font-bold">{"// Predicted Dependency Graph"}</div>
                    <div>api-gateway ──▶ auth-service (health: required)</div>
                    <div>api-gateway ──▶ payment-worker (timeout: 5000ms [RISK])</div>
                    <div>payment-worker ──▶ redis-cache (circuit-breaker: none)</div>
                    <div>payment-worker ──▶ postgres-db (pool_size: 20)</div>
                  </div>
                  <div className="text-amber-400 text-[11px]">
                    ⚠ BlastRadius Warning: High central dependency on redis-cache with zero isolation.
                  </div>
                </div>
              )}

              {activeStep.id === "break" && (
                <div className="space-y-3">
                  <div className="text-cyan-400">$ br chaos inject --service redis-cache --latency 350ms --jitter 20ms</div>
                  <div className="text-slate-400">$ k6 run --vus 300 --duration 30s load/synthetic_checkout.js</div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>VUs Active: 300</span>
                      <span className="text-rose-400">Latency: Spiking</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-gradient-to-r from-blue-500 to-rose-500 h-full w-[85%] animate-pulse" />
                    </div>
                    <div className="text-slate-500 text-[10px] pt-1">Sandboxed containers: br-test-api, br-test-payment, br-test-redis</div>
                  </div>
                </div>
              )}

              {activeStep.id === "measure" && (
                <div className="space-y-3">
                  <div className="text-emerald-400">✓ Statistical Evidence Captured (p &lt; 0.001)</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                      <div className="text-slate-400">p95 Latency</div>
                      <div className="text-lg font-bold text-rose-400">485ms <span className="text-xs text-rose-300">(+1630%)</span></div>
                      <div className="text-slate-500 text-[10px]">baseline: 28ms</div>
                    </div>
                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                      <div className="text-slate-400">Failed Requests</div>
                      <div className="text-lg font-bold text-rose-400">16.4% <span className="text-xs text-rose-300">(504 Timeout)</span></div>
                      <div className="text-slate-500 text-[10px]">p-value: 0.00018</div>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Cache Hit Ratio: <strong className="text-amber-300">unavailable</strong></span>
                    <span className="text-emerald-400">Metrics integrity verified</span>
                  </div>
                </div>
              )}

              {activeStep.id === "fix" && (
                <div className="space-y-2">
                  <div className="text-blue-400 flex items-center gap-1.5">
                    <Wand2 className="h-3.5 w-3.5" />
                    <span>Gemini Agent Recommended Patch (docker-compose.override.yml):</span>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-[11px] space-y-0.5">
                    <div className="text-slate-500">services:</div>
                    <div className="text-slate-500">&nbsp;&nbsp;payment-worker:</div>
                    <div className="text-slate-500">&nbsp;&nbsp;&nbsp;&nbsp;environment:</div>
                    <div className="text-rose-400">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- REDIS_TIMEOUT=5000ms</div>
                    <div className="text-emerald-400">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ REDIS_TIMEOUT=450ms</div>
                    <div className="text-emerald-400">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ CIRCUIT_BREAKER_ENABLED=true</div>
                    <div className="text-emerald-400">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ FALLBACK_CACHE_GRACE=true</div>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Prompt formatted for Claude Code / Cursor / Aider.
                  </div>
                </div>
              )}

              {activeStep.id === "prove" && (
                <div className="space-y-3">
                  <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                    <span>Regression Verification Passed (Identical 300 VUs)</span>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-[11px] space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-300">Metric</span>
                      <span className="text-slate-400">Before</span>
                      <span className="text-emerald-400">After Fix</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-800 pt-1">
                      <span>p95 Latency</span>
                      <span className="text-rose-400 line-through">485ms</span>
                      <span className="text-emerald-400 font-bold">32ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Error Rate</span>
                      <span className="text-rose-400 line-through">16.4%</span>
                      <span className="text-emerald-400 font-bold">0.00%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cascading Drops</span>
                      <span className="text-rose-400">3 services</span>
                      <span className="text-emerald-400 font-bold">Isolated to 0</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Proof Tag */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>Environment: Local Docker Sandbox</span>
              <span>Evidence Tag: CBS-PROVE-9842</span>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </section>
  )
}
