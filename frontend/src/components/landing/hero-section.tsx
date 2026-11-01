"use client"

import React, { useState, useRef } from "react"
import Link from "next/link"
import { motion, useScroll, useTransform, useSpring, useMotionValueEvent } from "motion/react"
import { ArrowRight, Check, Copy, ShieldCheck, Zap, Sparkles, Database, Play } from "lucide-react"

export function HeroSection() {
  const [copied, setCopied] = useState(false)
  const [activeCard, setActiveCard] = useState<number>(0)
  const [hoveredCard, setHoveredCard] = useState<number | null>(null)
  const cmd = "br run --compose docker-compose.yml"
  const cardsRef = useRef<HTMLDivElement>(null)

  // =========================================================================
  // 1. Scroll-Driven Broken "production" Metaphor
  // Starts cracking ONLY after scrolling past 35px.
  // On initial page load (scrollY <= 35px), "production" is 100% solid & unbroken!
  // =========================================================================
  const { scrollY } = useScroll()
  const crackProgress = useTransform(scrollY, [35, 220], [0, 1])
  const smoothCrack = useSpring(crackProgress, { stiffness: 220, damping: 28 })

  // Offsets for the fractured halves
  const breakTopY = useTransform(smoothCrack, [0, 1], [0, -10])
  const breakTopX = useTransform(smoothCrack, [0, 1], [0, -6])
  const breakTopRotate = useTransform(smoothCrack, [0, 1], [0, -4])

  const breakBottomY = useTransform(smoothCrack, [0, 1], [0, 10])
  const breakBottomX = useTransform(smoothCrack, [0, 1], [0, 6])
  const breakBottomRotate = useTransform(smoothCrack, [0, 1], [0, 4])

  // Electric fracture glow opacity
  const crackLineOpacity = useTransform(smoothCrack, [0, 0.1, 1], [0, 1, 1])

  // Solid unbroken pill opacity: 1 on initial load / top of page, fades to 0 as crack splits
  const solidPillOpacity = useTransform(smoothCrack, [0, 0.05], [1, 0])
  const splitPillOpacity = useTransform(smoothCrack, [0, 0.04], [0, 1])

  // =========================================================================
  // 2. Scroll-Driven Individual Feature Card Glow & Highlight
  // Sequentially activates Card 0 -> Card 1 -> Card 2 -> Card 3 as user scrolls!
  // =========================================================================
  const { scrollYProgress: cardsScroll } = useScroll({
    target: cardsRef,
    offset: ["start 85%", "start 25%"],
  })

  const smoothCards = useSpring(cardsScroll, {
    stiffness: 120,
    damping: 24,
  })

  useMotionValueEvent(smoothCards, "change", (val) => {
    const p = Math.max(0, Math.min(1, val))
    if (p < 0.25) {
      setActiveCard(0)
    } else if (p < 0.50) {
      setActiveCard(1)
    } else if (p < 0.75) {
      setActiveCard(2)
    } else {
      setActiveCard(3)
    }
  })

  const handleCopy = () => {
    navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const featureCards = [
    {
      id: 0,
      title: "100% Safe Sandbox",
      subtitle: "Isolated Host Ports",
      tag: "Air-Gapped",
      icon: ShieldCheck,
      color: "emerald",
      activeClasses:
        "bg-emerald-500/20 dark:bg-emerald-950/80 border-emerald-500 text-emerald-950 dark:text-emerald-100 shadow-[0_12px_32px_rgba(16,185,129,0.35)] -translate-y-2 scale-[1.04] ring-4 ring-emerald-400/30",
      activeBadge: "bg-emerald-500 text-slate-950 font-black",
      inactiveBadge: "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300",
      iconBoxActive: "bg-emerald-500 text-slate-950 shadow-md",
      iconBoxInactive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    {
      id: 1,
      title: "Zero Fake Numbers",
      subtitle: "Real HTTP Traffic",
      tag: "k6 Synthetic",
      icon: Zap,
      color: "purple",
      activeClasses:
        "bg-purple-500/20 dark:bg-purple-950/80 border-purple-500 text-purple-950 dark:text-purple-100 shadow-[0_12px_32px_rgba(168,85,247,0.35)] -translate-y-2 scale-[1.04] ring-4 ring-purple-400/30",
      activeBadge: "bg-purple-500 text-white font-black",
      inactiveBadge: "bg-purple-500/20 text-purple-800 dark:text-purple-300",
      iconBoxActive: "bg-purple-500 text-white shadow-md",
      iconBoxInactive: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    },
    {
      id: 2,
      title: "Paste-Ready Fixes",
      subtitle: "Direct YAML Diff",
      tag: "Gemini Fix",
      icon: Sparkles,
      color: "amber",
      activeClasses:
        "bg-amber-500/20 dark:bg-amber-950/80 border-amber-500 text-amber-950 dark:text-amber-100 shadow-[0_12px_32px_rgba(245,158,11,0.35)] -translate-y-2 scale-[1.04] ring-4 ring-amber-400/30",
      activeBadge: "bg-amber-500 text-slate-950 font-black",
      inactiveBadge: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
      iconBoxActive: "bg-amber-500 text-slate-950 shadow-md",
      iconBoxInactive: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    {
      id: 3,
      title: "₹0 Open Source Stack",
      subtitle: "Docker Native Engine",
      tag: "₹0 Budget",
      icon: Database,
      color: "sky",
      activeClasses:
        "bg-sky-500/20 dark:bg-sky-950/80 border-sky-500 text-sky-950 dark:text-sky-100 shadow-[0_12px_32px_rgba(14,165,233,0.35)] -translate-y-2 scale-[1.04] ring-4 ring-sky-400/30",
      activeBadge: "bg-sky-500 text-white font-black",
      inactiveBadge: "bg-sky-500/20 text-sky-800 dark:text-sky-300",
      iconBoxActive: "bg-sky-500 text-white shadow-md",
      iconBoxInactive: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    },
  ]

  return (
    <motion.section
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative pt-32 sm:pt-40 pb-16 px-4 max-w-5xl mx-auto flex flex-col items-center text-center overflow-visible"
    >
      {/* Top Hackathon & Agent Badge */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/5 dark:bg-white/10 border border-slate-300/80 dark:border-white/15 backdrop-blur-md shadow-xs mb-8 text-xs font-black text-slate-800 dark:text-slate-200">
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span>CBS 9.0 Hackathon • Autonomous AI Reliability Agent</span>
      </div>

      {/* Main Bold Headline with Scroll-Driven Broken "production" Fracture */}
      <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tight text-slate-950 dark:text-white leading-[1.05] max-w-4xl">
        Break it before{" "}
        
        {/* The Broken Word: Unbroken on page load; fractures along zig-zag crack on scroll */}
        <span className="relative inline-block my-1 mx-1.5 select-none align-middle">
          
          {/* Solid Unbroken Badge: Visible on initial landing so there is zero seam! */}
          <motion.span
            style={{ opacity: solidPillOpacity }}
            className="px-3.5 sm:px-4 py-1 rounded-2xl bg-amber-300 dark:bg-amber-400 text-slate-950 font-black shadow-md inline-block"
          >
            production
          </motion.span>

          {/* Top Jagged Fragment (Emerges smoothly on scroll) */}
          <motion.span
            style={{
              opacity: splitPillOpacity,
              y: breakTopY,
              x: breakTopX,
              rotate: breakTopRotate,
              clipPath: "polygon(0% 0%, 100% 0%, 100% 52%, 82% 38%, 66% 60%, 50% 40%, 34% 60%, 18% 40%, 0% 54%)",
            }}
            className="px-3.5 sm:px-4 py-1 rounded-2xl bg-amber-300 dark:bg-amber-400 text-slate-950 font-black shadow-md inline-block absolute inset-0 transform pointer-events-none"
          >
            production
          </motion.span>

          {/* Bottom Jagged Fragment (Emerges smoothly on scroll) */}
          <motion.span
            style={{
              opacity: splitPillOpacity,
              y: breakBottomY,
              x: breakBottomX,
              rotate: breakBottomRotate,
              clipPath: "polygon(0% 54%, 18% 40%, 34% 60%, 50% 40%, 66% 60%, 82% 38%, 100% 52%, 100% 100%, 0% 100%)",
            }}
            className="px-3.5 sm:px-4 py-1 rounded-2xl bg-amber-300 dark:bg-amber-400 text-slate-950 font-black shadow-md inline-block absolute inset-0 transform pointer-events-none"
          >
            production
          </motion.span>

          {/* Glowing Electric Fracture Line in the Split Gap */}
          <motion.div
            style={{ opacity: crackLineOpacity }}
            className="absolute inset-0 pointer-events-none flex items-center justify-center z-10"
          >
            <div className="w-full h-1 bg-gradient-to-r from-amber-500 via-rose-500 to-amber-400 blur-[1px] shadow-lg shadow-rose-500/80" />
            <span className="absolute -top-3 text-[10px] text-amber-500 font-bold animate-pulse">⚡ BREAK</span>
          </motion.div>
        </span>{" "}
        does.
      </h1>

      {/* Clean, High-Contrast Subtitle */}
      <p className="mt-6 text-base sm:text-xl text-slate-700 dark:text-slate-200 max-w-2xl leading-relaxed font-semibold">
        The autonomous reliability agent for Docker Compose. Discovers your microservices, injects sandboxed chaos under real synthetic traffic, and hands you verified patches with before/after proof.
      </p>

      {/* CTAs: High-Contrast "TRY IT" Button + Enhanced Command Power Capsule */}
      <div className="mt-9 flex flex-col sm:flex-row items-center gap-3.5 sm:gap-4 w-full sm:w-auto">
        {/* High-Contrast "TRY IT" Button */}
        <Link
          href="/dashboard"
          className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-slate-950 hover:bg-slate-800 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 font-black text-sm tracking-tight flex items-center justify-center gap-2.5 shadow-xl shadow-slate-950/20 dark:shadow-emerald-500/30 hover:scale-[1.03] active:scale-[0.98] transition-all border border-slate-800 dark:border-emerald-300 group cursor-pointer"
        >
          <Zap className="h-4 w-4 fill-current text-amber-400 dark:text-slate-950" />
          <span>TRY IT</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>

        {/* Enhanced `br run` Command Power Capsule */}
        <div
          onClick={handleCopy}
          className="w-full sm:w-auto p-1 rounded-2xl bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-500 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer group"
        >
          <div className="px-4 py-2.5 rounded-[13px] bg-slate-950 text-white flex items-center justify-between gap-3 select-none">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-500/20 border border-purple-400/40 text-purple-300 text-[10px] font-black font-mono uppercase tracking-wider shrink-0">
              <Play className="h-2.5 w-2.5 fill-purple-300" />
              <span>RUN</span>
            </div>

            <div className="flex items-center gap-1.5 font-mono text-xs sm:text-sm font-bold tracking-tight text-slate-100">
              <span className="text-cyan-400 font-black">br</span>
              <span>run --compose docker-compose.yml</span>
            </div>

            <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 group-hover:bg-white/20 border border-white/10 text-[11px] font-bold text-white transition-colors shrink-0">
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-300 font-mono">COPIED</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-300 group-hover:text-white" />
                  <span className="text-slate-300 group-hover:text-white font-mono">COPY</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          Scroll-Driven 4 Feature Cards (Individual Sequential Glow on Scroll!)
          ========================================================================= */}
      <div ref={cardsRef} className="w-full max-w-4xl mt-16 select-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4 text-left">
          {featureCards.map((card) => {
            const Icon = card.icon
            const isActive = hoveredCard !== null ? hoveredCard === card.id : activeCard === card.id

            return (
              <div
                key={card.id}
                onMouseEnter={() => setHoveredCard(card.id)}
                onMouseLeave={() => setHoveredCard(null)}
                className={`p-4 rounded-2xl border transition-all duration-300 flex flex-col justify-between cursor-pointer group ${
                  isActive
                    ? card.activeClasses
                    : "bg-white/60 dark:bg-slate-900/40 border-slate-300/60 dark:border-white/10 opacity-75 hover:opacity-100 shadow-sm"
                }`}
              >
                {/* Top Badge & Icon */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div
                    className={`p-2 rounded-xl transition-all ${
                      isActive ? card.iconBoxActive : card.iconBoxInactive
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${
                      isActive ? card.activeBadge : card.inactiveBadge
                    }`}
                  >
                    {card.tag}
                  </span>
                </div>

                {/* Content */}
                <div>
                  <h3 className="text-sm font-black text-slate-950 dark:text-white leading-tight">
                    {card.title}
                  </h3>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 font-mono mt-1 font-semibold">
                    {card.subtitle}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </motion.section>
  )
}
