"use client"

import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import { 
  Play, 
  RotateCcw, 
  ShieldAlert, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  Activity, 
  Cpu, 
  Database, 
  Server, 
  ArrowRight, 
  Bot,
  Sparkles,
  Check,
  FileCode,
  Flame
} from "lucide-react"

type FaultType = "redis_delay" | "payment_502" | "auth_oom" | "db_exhaust"

interface FaultOption {
  id: FaultType
  title: string
  service: string
  description: string
  severity: "high" | "critical" | "medium"
}

const FAULTS: FaultOption[] = [
  {
    id: "redis_delay",
    title: "Inject +350ms Redis Latency",
    service: "redis-cache",
    description: "Simulates network throttle under 300 VUs synthetic load",
    severity: "high"
  },
  {
    id: "payment_502",
    title: "Payment Gateway 502 Outage",
    service: "payment-worker",
    description: "Simulates third-party provider failure cascade",
    severity: "critical"
  },
  {
    id: "auth_oom",
    title: "Auth Container Memory Kill",
    service: "auth-service",
    description: "Forces cgroup OOM killer invocation in local sandbox",
    severity: "critical"
  },
  {
    id: "db_exhaust",
    title: "Postgres Pool Starvation",
    service: "postgres-db",
    description: "Spikes connection count beyond max_connections cap",
    severity: "medium"
  }
]

export function LiveChaosSimulator() {
  const [selectedFault, setSelectedFault] = useState<FaultType>("redis_delay")
  const [state, setState] = useState<"idle" | "breaking" | "measuring" | "fixing" | "proven">("idle")
  const [progress, setProgress] = useState(0)

  const activeFault = FAULTS.find(f => f.id === selectedFault)!

  const handleStartSimulation = () => {
    setState("breaking")
    setProgress(20)

    setTimeout(() => {
      setState("measuring")
      setProgress(50)
    }, 1800)

    setTimeout(() => {
      setState("fixing")
      setProgress(80)
    }, 3800)

    setTimeout(() => {
      setState("proven")
      setProgress(100)
    }, 5800)
  }

  const handleReset = () => {
    setState("idle")
    setProgress(0)
  }

  return (
    <section id="simulator" className="relative py-16 sm:py-24 px-4 sm:px-6 max-w-6xl mx-auto">
      {/* Section Header */}
      <div className="flex flex-col items-center text-center mb-10 sm:mb-14">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide border bg-white/70 dark:bg-slate-900/70 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 shadow-xs backdrop-blur-md mb-3">
          <span className="material-symbols-rounded text-sm">science</span>
          <span>Interactive Chaos Studio</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-950 dark:text-white">
          Experience the autonomous loop in real time.
        </h2>
        <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl">
          Pick a fault, trigger k6 synthetic traffic, watch BlastRadius map the blast radius, and witness the Gemini agent generate and prove the patch.
        </p>
      </div>

      {/* Main Glass Simulator Canvas */}
      <div className="glass-panel rounded-3xl p-4 sm:p-8 shadow-2xl border-white/80 dark:border-white/10 relative overflow-hidden">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200/60 dark:border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Sandbox Status: <strong>Isolated & Healthy</strong></span>
            </div>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">127.0.0.1 (Air-Gapped)</span>
          </div>

          {/* Stepper Progress Indicator */}
          <div className="flex items-center gap-2">
            {[
              { id: "idle", label: "01. Ready" },
              { id: "breaking", label: "02. Break" },
              { id: "measuring", label: "03. Measure" },
              { id: "fixing", label: "04. AI Fix" },
              { id: "proven", label: "05. Proven" }
            ].map((step, idx) => {
              const isCurrent = state === step.id
              const isPast = ["breaking", "measuring", "fixing", "proven"].indexOf(state) >= idx
              return (
                <div
                  key={step.id}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                    isCurrent
                      ? "bg-blue-600 text-white shadow-xs"
                      : isPast
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300"
                      : "text-slate-400 bg-slate-100/50 dark:bg-slate-800/40"
                  }`}
                >
                  {step.label}
                </div>
              )
            })}
          </div>
        </div>

        {/* Fault Selector Pills */}
        <div className="mt-6">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-3">
            Select Chaos Fault Injection Experiment:
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {FAULTS.map((f) => {
              const isSelected = selectedFault === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    if (state === "idle" || state === "proven") {
                      setSelectedFault(f.id)
                      setState("idle")
                    }
                  }}
                  disabled={state === "breaking" || state === "measuring"}
                  className={`text-left p-3 rounded-2xl border transition-all duration-200 relative ${
                    isSelected
                      ? "bg-white dark:bg-slate-800/90 border-blue-500 shadow-md shadow-blue-500/10 scale-[1.01]"
                      : "bg-white/50 dark:bg-slate-900/40 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {f.service}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase ${
                      f.severity === "critical" ? "text-rose-500" : "text-amber-500"
                    }`}>
                      {f.severity}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                    {f.title}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug line-clamp-1">
                    {f.description}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Action Trigger Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {state === "idle" ? (
              <button
                onClick={handleStartSimulation}
                className="group px-6 py-2.5 rounded-full text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2"
              >
                <Play className="h-4 w-4 fill-white transition-transform group-hover:scale-110" />
                <span>Inject Chaos & Run Synthetic Load</span>
              </button>
            ) : state === "proven" ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 glass-pill hover:bg-white dark:hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Reset Experiment</span>
                </button>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-xs font-semibold border border-emerald-300/50">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Fix Verified via Same-Config Re-run</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-5 py-2.5 rounded-full bg-slate-900 text-white dark:bg-slate-800 text-xs font-mono">
                <span className="material-symbols-rounded text-sm animate-spin text-blue-400">autorenew</span>
                <span>
                  {state === "breaking" && "Injecting Fault into Sandbox Container & Spiking k6 Traffic..."}
                  {state === "measuring" && "Capturing Statistical Metrics (p50/p95/p99 & Latency Delta)..."}
                  {state === "fixing" && "Gemini Agent Analyzing Telemetry & Generating Patch..."}
                </span>
              </div>
            )}
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            {state === "idle" && "Ready to simulate fault"}
            {state === "breaking" && "⚡ Phase 2/5: Chaos Active"}
            {state === "measuring" && "📊 Phase 3/5: Telemetry Gathered"}
            {state === "fixing" && "🤖 Phase 4/5: Gemini Formulating Fix"}
            {state === "proven" && "✅ Phase 5/5: Proof Certified"}
          </div>
        </div>

        {/* Dynamic Interactive Stage: Topology Graph & Real-Time Telemetry */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Topology Canvas (Left 7 Cols) */}
          <div className="lg:col-span-7 rounded-2xl bg-slate-950/5 dark:bg-slate-950/60 p-4 sm:p-6 border border-slate-200/60 dark:border-slate-800 flex flex-col justify-between min-h-[380px] relative overflow-hidden">
            {/* Ambient grid lines */}
            <div className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(#2563eb_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

            {/* Topology Title */}
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Docker Compose Sandbox Mesh
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold">
                  5 Services
                </span>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                {state === "idle" ? "Baseline Traffic: 50 VUs" : "Synthetic k6 Load: 300 VUs"}
              </span>
            </div>

            {/* Visual Node Diagram */}
            <div className="relative my-auto py-6 flex flex-col items-center gap-8 z-10">
              {/* Top Node: API Gateway */}
              <div className="relative group">
                <div className={`px-5 py-3 rounded-2xl border transition-all duration-300 flex items-center gap-3 ${
                  state === "breaking" || state === "measuring"
                    ? "bg-rose-50 dark:bg-rose-950/40 border-rose-400 text-rose-950 dark:text-rose-200 shadow-lg shadow-rose-500/20"
                    : state === "proven"
                    ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-950 dark:text-emerald-200"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-md"
                }`}>
                  <Server className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <div className="text-xs font-bold font-mono">api-gateway:8000</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Reverse Proxy & Ingress</div>
                  </div>
                  {state === "breaking" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-500 text-white font-bold animate-pulse">
                      Degraded
                    </span>
                  )}
                  {state === "proven" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500 text-white font-bold">
                      Protected
                    </span>
                  )}
                </div>

                {/* Animated Connecting Lines Down */}
                <div className="absolute left-1/2 -bottom-8 w-px h-8 bg-gradient-to-b from-blue-400 to-slate-400 dark:from-blue-600 dark:to-slate-700 -translate-x-1/2" />
              </div>

              {/* Mid Layer: Auth Service & Payment Worker */}
              <div className="w-full flex items-center justify-around gap-4 px-2">
                {/* Auth Service */}
                <div className={`px-4 py-3 rounded-2xl border transition-all duration-300 flex items-center gap-2.5 max-w-[200px] ${
                  selectedFault === "auth_oom" && (state === "breaking" || state === "measuring")
                    ? "bg-rose-100 dark:bg-rose-900/50 border-rose-500 text-rose-950 dark:text-rose-200 shadow-xl shadow-rose-500/30 scale-105"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm"
                }`}>
                  <Cpu className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <div>
                    <div className="text-xs font-bold font-mono">auth-service</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">JWT Token Auth</div>
                  </div>
                </div>

                {/* Payment Worker */}
                <div className={`px-4 py-3 rounded-2xl border transition-all duration-300 flex items-center gap-2.5 max-w-[200px] ${
                  (selectedFault === "payment_502" || selectedFault === "redis_delay") && (state === "breaking" || state === "measuring")
                    ? "bg-amber-100 dark:bg-amber-950/60 border-amber-500 text-amber-950 dark:text-amber-200 shadow-xl shadow-amber-500/20 scale-105"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm"
                }`}>
                  <Activity className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <div>
                    <div className="text-xs font-bold font-mono">payment-worker</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Checkout Stream</div>
                  </div>
                  {(selectedFault === "payment_502" || selectedFault === "redis_delay") && (state === "breaking" || state === "measuring") && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 animate-bounce" />
                  )}
                </div>
              </div>

              {/* Bottom Layer: Redis Cache & Postgres DB */}
              <div className="w-full flex items-center justify-around gap-4 px-2">
                {/* Redis Node */}
                <div className={`px-4 py-3 rounded-2xl border transition-all duration-300 flex items-center gap-2.5 max-w-[200px] ${
                  selectedFault === "redis_delay" && (state === "breaking" || state === "measuring")
                    ? "bg-rose-100 dark:bg-rose-900/60 border-rose-500 text-rose-950 dark:text-rose-200 shadow-xl shadow-rose-500/30 scale-105"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm"
                }`}>
                  <Flame className="h-4 w-4 text-rose-500" />
                  <div>
                    <div className="text-xs font-bold font-mono">redis-cache</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Session & Cache</div>
                  </div>
                  {selectedFault === "redis_delay" && (state === "breaking" || state === "measuring") && (
                    <span className="text-[10px] font-bold text-rose-600 font-mono">+350ms</span>
                  )}
                </div>

                {/* Postgres DB */}
                <div className={`px-4 py-3 rounded-2xl border transition-all duration-300 flex items-center gap-2.5 max-w-[200px] ${
                  selectedFault === "db_exhaust" && (state === "breaking" || state === "measuring")
                    ? "bg-rose-100 dark:bg-rose-900/60 border-rose-500 text-rose-950 dark:text-rose-200 scale-105 shadow-xl"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm"
                }`}>
                  <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <div className="text-xs font-bold font-mono">postgres-db</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Relational Store</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Status bar */}
            <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              <span>Blast Radius Calculation: <strong>{state === "breaking" || state === "measuring" ? "3 of 5 Services Impacted" : "0 Failures"}</strong></span>
              <span>Guaranteed Sandbox Rollback: Active</span>
            </div>
          </div>

          {/* Real-time Telemetry & Agent Remedy (Right 5 Cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Live Metrics Card */}
            <div className="rounded-2xl bg-white dark:bg-slate-900/80 p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-blue-500" />
                  Statistical Telemetry (k6)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  Honest Numbers
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">p95 Latency</div>
                  <div className={`text-lg font-bold font-mono transition-colors ${
                    state === "breaking" || state === "measuring" ? "text-rose-600 dark:text-rose-400" : state === "proven" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"
                  }`}>
                    {state === "idle" && "28ms"}
                    {(state === "breaking" || state === "measuring") && "485ms"}
                    {state === "fixing" && "485ms"}
                    {state === "proven" && "32ms"}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {state === "breaking" ? "+1,632%" : state === "proven" ? "-93% delta" : "nominal"}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Error Rate</div>
                  <div className={`text-lg font-bold font-mono transition-colors ${
                    state === "breaking" || state === "measuring" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
                  }`}>
                    {state === "idle" && "0.0%"}
                    {(state === "breaking" || state === "measuring") && "16.4%"}
                    {state === "fixing" && "16.4%"}
                    {state === "proven" && "0.0%"}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {state === "breaking" ? "504 Timeouts" : "0 dropped"}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Throughput</div>
                  <div className="text-lg font-bold font-mono text-slate-900 dark:text-white">
                    {state === "idle" && "840 r/s"}
                    {(state === "breaking" || state === "measuring") && "210 r/s"}
                    {state === "fixing" && "210 r/s"}
                    {state === "proven" && "915 r/s"}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {state === "breaking" ? "Throttled" : "Max Load"}
                  </div>
                </div>
              </div>
            </div>

            {/* Gemini AI Agent Remediation Box (Heavy Antigravity Inspo) */}
            <div className="rounded-2xl bg-gradient-to-br from-blue-900/10 via-slate-900/5 to-indigo-900/10 dark:from-blue-950/40 dark:to-slate-900/80 p-5 border border-blue-200/80 dark:border-blue-900/40 shadow-md flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Gemini Reliability Agent
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                    9 Typed Tools
                  </span>
                </div>

                {/* Agent Thought / Output */}
                <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed mt-2 min-h-[70px]">
                  {state === "idle" && (
                    <p className="italic text-slate-500 dark:text-slate-400">
                      &quot;Awaiting experiment launch. When you inject a fault, I will observe the empirical telemetry without falsified numbers and formulate a verified patch.&quot;
                    </p>
                  )}
                  {state === "breaking" && (
                    <p className="text-rose-600 dark:text-rose-400 font-medium">
                      ⚠️ &quot;Fault detected: Redis latency spiked to +350ms. Payment Worker thread pool blocked waiting on synchronous cache calls. Recommending immediate circuit breaker.&quot;
                    </p>
                  )}
                  {state === "measuring" && (
                    <p className="text-slate-800 dark:text-slate-200">
                      📊 &quot;Statistical analysis complete (p &lt; 0.001 significance). 16.4% of checkout requests timed out after 5000ms. Root cause: unbounded upstream timeout configuration.&quot;
                    </p>
                  )}
                  {(state === "fixing" || state === "proven") && (
                    <div className="space-y-2">
                      <p className="text-emerald-700 dark:text-emerald-300 font-medium">
                        ✨ &quot;Generated unified patch for docker-compose.override.yml: Configured 450ms circuit breaker timeout and exponential backoff retry cap.&quot;
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Code Diff Box when fix is available */}
              {(state === "fixing" || state === "proven") && (
                <div className="mt-3 rounded-xl bg-slate-950 p-3 text-[11px] font-mono text-slate-200 border border-slate-800 overflow-x-auto">
                  <div className="text-slate-400 text-[10px] pb-1 border-b border-slate-800 flex items-center justify-between">
                    <span>docker-compose.override.yml</span>
                    <span className="text-emerald-400">+4 / -2 lines</span>
                  </div>
                  <div className="pt-2 space-y-0.5">
                    <div className="text-rose-400 bg-rose-950/30 px-1 rounded">- REDIS_TIMEOUT: 5000ms</div>
                    <div className="text-rose-400 bg-rose-950/30 px-1 rounded">- MAX_RETRIES: 10</div>
                    <div className="text-emerald-400 bg-emerald-950/40 px-1 rounded">+ REDIS_TIMEOUT: 450ms</div>
                    <div className="text-emerald-400 bg-emerald-950/40 px-1 rounded">+ MAX_RETRIES: 2</div>
                    <div className="text-emerald-400 bg-emerald-950/40 px-1 rounded">+ CIRCUIT_BREAKER: &quot;true&quot;</div>
                    <div className="text-emerald-400 bg-emerald-950/40 px-1 rounded">+ FALLBACK_DEGRADED: &quot;true&quot;</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
