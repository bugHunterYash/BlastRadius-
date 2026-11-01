"use client"

import React, { useState } from "react"
import { RotateCcw, Sparkles, Terminal, ShieldCheck, Flame, CheckCircle2, AlertTriangle, Activity } from "lucide-react"

type ChaosType = "none" | "redis_down" | "latency" | "load_surge"

export function PixelPlayground() {
  const [chaos, setChaos] = useState<ChaosType>("none")
  const [fixed, setFixed] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  const handleTrigger = (type: ChaosType) => {
    setChaos(type)
    setFixed(false)
  }

  const handleFix = () => {
    setIsVerifying(true)
    setTimeout(() => {
      setIsVerifying(false)
      setFixed(true)
    }, 600)
  }

  const handleReset = () => {
    setChaos("none")
    setFixed(false)
    setIsVerifying(false)
  }

  return (
    <section id="playground" className="relative py-8 sm:py-14 px-4 max-w-5xl mx-auto">
      {/* Pure Black AMOLED Mac Terminal */}
      <div className="rounded-2xl bg-[#030407] border-2 border-neutral-800/90 shadow-[0_25px_80px_rgba(0,0,0,0.95)] overflow-hidden text-neutral-200">
        
        {/* macOS Chrome Title Bar */}
        <div className="px-4 py-2.5 bg-[#090b10] border-b border-neutral-800 flex items-center justify-between select-none">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block shadow-xs" />
            <span className="h-3 w-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block shadow-xs" />
            <span className="h-3 w-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block shadow-xs" />
            
            <div className="ml-3 hidden sm:flex items-center gap-2 text-xs font-mono font-bold text-neutral-300">
              <Terminal className="h-3.5 w-3.5 text-cyan-400" />
              <span>blastradius-sandbox — zsh — 127.0.0.1:8000 (3 pods, 50 VUs)</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${chaos === "none" || fixed ? "bg-emerald-400 animate-pulse" : "bg-rose-500 animate-ping"}`} />
            <span className="font-mono text-xs font-extrabold tracking-wide">
              {chaos === "none" && <span className="text-emerald-400">SANDBOX: NOMINAL</span>}
              {chaos !== "none" && !fixed && <span className="text-rose-400">CHAOS INJECTED</span>}
              {fixed && <span className="text-emerald-400">PROVEN RESILIENT</span>}
            </span>
          </div>
        </div>

        {/* Action Header: Tactile Chaos Fault Toggles */}
        <div className="px-4 sm:px-5 py-3 bg-[#06070a] border-b border-neutral-800/80 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-400 mr-1 flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-rose-500" />
              <span className="text-neutral-200">Inject Fault:</span>
            </span>

            <button
              onClick={() => handleTrigger("redis_down")}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                chaos === "redis_down"
                  ? "bg-rose-600 text-white shadow-md shadow-rose-600/40 ring-2 ring-rose-400"
                  : "bg-neutral-900 hover:bg-neutral-800 text-rose-300 border border-neutral-800 hover:border-rose-500/50"
              }`}
            >
              <span>💥 Kill Redis</span>
            </button>

            <button
              onClick={() => handleTrigger("latency")}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                chaos === "latency"
                  ? "bg-amber-400 text-neutral-950 shadow-md shadow-amber-400/40 ring-2 ring-amber-300 font-black"
                  : "bg-neutral-900 hover:bg-neutral-800 text-amber-300 border border-neutral-800 hover:border-amber-500/50"
              }`}
            >
              <span>⚡ +350ms Latency</span>
            </button>

            <button
              onClick={() => handleTrigger("load_surge")}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                chaos === "load_surge"
                  ? "bg-sky-500 text-white shadow-md shadow-sky-500/40 ring-2 ring-sky-300"
                  : "bg-neutral-900 hover:bg-neutral-800 text-sky-300 border border-neutral-800 hover:border-sky-500/50"
              }`}
            >
              <span>🌊 300 VUs Surge</span>
            </button>
          </div>

          {(chaos !== "none" || fixed) && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-700 transition-colors flex items-center gap-1.5 font-mono text-xs font-bold cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset Sandbox</span>
            </button>
          )}
        </div>

        {/* Microservice Live Status Cards (High Density & Contrast) */}
        <div className="p-4 sm:p-5 bg-[#030407] grid grid-cols-1 sm:grid-cols-3 gap-3">
          
          {/* Card 1: API Gateway */}
          <div className={`p-3.5 rounded-xl border-2 transition-all duration-200 ${
            chaos !== "none" && !fixed
              ? "bg-[#180508] border-rose-500/80 shadow-lg shadow-rose-950/50"
              : fixed
              ? "bg-[#05140b] border-emerald-500/70"
              : "bg-[#090b10] border-neutral-800 hover:border-neutral-700"
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-black bg-sky-500/20 text-sky-300 border border-sky-500/40">
                api-gateway:8000
              </span>
              <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">Ingress</span>
            </div>
            <div className="text-sm font-mono font-black mt-2">
              {chaos === "none" && <span className="text-emerald-400">● 200 OK • Nominal</span>}
              {chaos !== "none" && !fixed && <span className="text-rose-400 animate-pulse">▲ 504 GATEWAY TIMEOUT</span>}
              {fixed && <span className="text-emerald-400">● 200 OK • Resilient</span>}
            </div>
            <div className="text-xs font-mono text-neutral-300 mt-1 flex justify-between font-bold">
              <span>Error Rate:</span>
              <span className={chaos !== "none" && !fixed ? "text-rose-400 font-black" : "text-emerald-400"}>
                {chaos !== "none" && !fixed ? "16.4% dropped" : "0.00%"}
              </span>
            </div>
          </div>

          {/* Card 2: Payment Worker */}
          <div className={`p-3.5 rounded-xl border-2 transition-all duration-200 ${
            chaos !== "none" && !fixed
              ? "bg-[#180f05] border-amber-500/80 shadow-lg shadow-amber-950/50"
              : fixed
              ? "bg-[#05140b] border-emerald-500/70"
              : "bg-[#090b10] border-neutral-800 hover:border-neutral-700"
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-black bg-pink-500/20 text-pink-300 border border-pink-500/40">
                payment-worker:5002
              </span>
              <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">Service</span>
            </div>
            <div className="text-sm font-mono font-black mt-2">
              {chaos === "none" && <span className="text-neutral-200 font-mono">p95: 24ms</span>}
              {chaos !== "none" && !fixed && <span className="text-amber-400 font-black">p95: 485ms (+1630%)</span>}
              {fixed && <span className="text-emerald-400 font-mono font-black">p95: 28ms (-94%)</span>}
            </div>
            <div className="text-xs font-mono text-neutral-300 mt-1 flex justify-between font-bold">
              <span>Thread Pool:</span>
              <span className={chaos !== "none" && !fixed ? "text-amber-400 font-black" : "text-emerald-400"}>
                {chaos !== "none" && !fixed ? "STARVED (Blocked)" : "Healthy (4/16)"}
              </span>
            </div>
          </div>

          {/* Card 3: Redis Cache */}
          <div className={`p-3.5 rounded-xl border-2 transition-all duration-200 ${
            chaos === "redis_down" && !fixed
              ? "bg-[#180508] border-rose-500/80"
              : chaos === "latency" && !fixed
              ? "bg-[#180a1c] border-purple-500/80"
              : chaos === "load_surge" && !fixed
              ? "bg-[#180f05] border-amber-500/80"
              : fixed
              ? "bg-[#05140b] border-emerald-500/70"
              : "bg-[#090b10] border-neutral-800 hover:border-neutral-700"
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-black bg-amber-500/20 text-amber-300 border border-amber-500/40">
                redis-cache:6379
              </span>
              <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">State</span>
            </div>
            <div className="text-sm font-mono font-black mt-2">
              {chaos === "none" && <span className="text-emerald-400">● 100% Up</span>}
              {chaos === "redis_down" && !fixed && <span className="text-rose-400">▲ OOM KILLED (SIGKILL)</span>}
              {chaos === "latency" && !fixed && <span className="text-purple-400">▲ +350ms Netem Delay</span>}
              {chaos === "load_surge" && !fixed && <span className="text-amber-400">▲ Conn Limit Starvation</span>}
              {fixed && <span className="text-emerald-400">● Circuit Isolated</span>}
            </div>
            <div className="text-xs font-mono text-neutral-300 mt-1 flex justify-between font-bold">
              <span>Circuit Breaker:</span>
              <span className={fixed ? "text-emerald-400 font-black" : "text-neutral-400"}>
                {fixed ? "OPEN (Bypassed)" : "Closed (Direct)"}
              </span>
            </div>
          </div>
        </div>

        {/* Gemini Autonomous Reliability Agent Card */}
        <div className="p-4 sm:p-5 bg-[#05060a] border-t-2 border-neutral-800/90">
          <div className="p-4 rounded-xl bg-[#090c14] border-2 border-neutral-700/80 shadow-2xl relative overflow-hidden">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-cyan-400 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <div className="text-sm font-black text-white flex items-center gap-2">
                    <span>Gemini 2.5 Reliability Agent</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
                      Autonomous Co-Pilot
                    </span>
                  </div>
                  <div className="text-xs text-neutral-400 font-mono">
                    Real-Time Root Cause Isolation &amp; Zero-Regression Patching
                  </div>
                </div>
              </div>

              {chaos !== "none" && !fixed && (
                <button
                  onClick={handleFix}
                  disabled={isVerifying}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-neutral-950 text-xs font-black font-mono transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/30 shrink-0 cursor-pointer"
                >
                  {isVerifying ? (
                    <>
                      <Activity className="h-3.5 w-3.5 animate-spin" />
                      <span>Verifying Sandbox...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" />
                      <span>Deploy &amp; Prove Patch in Sandbox →</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Diagnostic Content */}
            <div className="mt-3.5 space-y-2.5 font-mono text-xs">
              {chaos === "none" && !fixed && (
                <div className="text-neutral-300 flex items-start gap-2 py-1">
                  <span className="text-emerald-400 font-black">➜</span>
                  <span>System nominal under baseline load. Trigger a fault above to observe how BlastRadius analyzes cascade failure and generates evidence-backed patches.</span>
                </div>
              )}

              {chaos !== "none" && !fixed && (
                <>
                  <div className="text-rose-200 flex items-start gap-2 leading-relaxed bg-rose-950/40 p-2.5 rounded-lg border-2 border-rose-800/60 font-semibold">
                    <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black text-rose-400">[ROOT CAUSE] </span>
                      <span>Redis synchronous delay (+350ms) depleted the payment-worker thread pool. Upstream Ingress gateway timed out after 5000ms threshold (16.4% dropped HTTP requests).</span>
                    </div>
                  </div>

                  {/* Clean High-Contrast Syntax-Highlighted Diff Editor */}
                  <div className="rounded-xl bg-black border-2 border-neutral-800 overflow-hidden font-mono text-[11px] mt-2">
                    <div className="px-3.5 py-1.5 bg-[#0e111a] border-b border-neutral-800 flex items-center justify-between text-neutral-300 text-[10px] font-bold">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3 w-3 text-cyan-400" />
                        <span className="text-neutral-200">docker-compose.override.yml</span>
                      </div>
                      <span className="text-emerald-400 font-black">+3 / -1 lines</span>
                    </div>
                    <div className="p-3 space-y-1 font-bold">
                      <div className="text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded -mx-1">
                        - REDIS_TIMEOUT: 5000ms
                      </div>
                      <div className="text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded -mx-1">
                        + REDIS_TIMEOUT: 450ms
                      </div>
                      <div className="text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded -mx-1">
                        + CIRCUIT_BREAKER_ENABLED: &quot;true&quot;
                      </div>
                      <div className="text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded -mx-1">
                        + FALLBACK_GRACE_CACHE: &quot;true&quot;
                      </div>
                    </div>
                  </div>
                </>
              )}

              {fixed && (
                <div className="p-3.5 rounded-xl bg-emerald-950/40 border-2 border-emerald-500/60 text-emerald-200 font-medium space-y-1.5">
                  <div className="flex items-center gap-2 text-emerald-400 font-black">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>[PROVEN IN AIR-GAPPED SANDBOX RE-RUN]</span>
                  </div>
                  <div className="text-neutral-100 text-xs pl-6 leading-relaxed font-semibold">
                    Circuit breaker successfully isolated Redis latency. Re-ran identical 300 VUs synthetic stress workload:
                    <span className="text-emerald-400 font-black"> p95 latency dropped from 485ms ➔ 28ms (-94%)</span>,
                    <span className="text-emerald-400 font-black"> dropped requests: 0.00%</span>. Zero regressions detected.
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
