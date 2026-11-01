"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { motion } from "motion/react"
import { Sun, Moon, ArrowRight, GitBranch, Zap } from "lucide-react"

export function Navbar() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <header className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
      {/* Translucent Frosted Glassmorphism Floating Dock (Synchronized Initial Entrance, No Hide) */}
      <motion.nav
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-auto bg-white/45 dark:bg-[#07090e]/50 backdrop-blur-xl border border-slate-900/10 dark:border-white/10 rounded-full px-4 sm:px-6 py-2.5 shadow-[0_8px_32px_0_rgba(0,0,0,0.06),inset_0_1px_1px_0_rgba(255,255,255,0.7)] dark:shadow-[0_12px_40px_0_rgba(0,0,0,0.7),inset_0_1px_1px_0_rgba(255,255,255,0.12)] flex items-center justify-between gap-4 sm:gap-8 max-w-4xl w-full select-none transition-colors duration-300"
      >
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 text-white flex items-center justify-center text-xs font-black shadow-md shadow-purple-500/25 group-hover:scale-105 transition-transform border border-white/40">
            BR
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-black text-sm sm:text-base tracking-tight text-slate-900 dark:text-white">
              Blast<span className="text-purple-600 dark:text-cyan-400">Radius</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-900/5 dark:bg-white/10 text-purple-700 dark:text-cyan-300 border border-purple-500/20 dark:border-white/15">
              v1.0
            </span>
          </div>
        </Link>

        {/* Minimalist Glass Nav Links */}
        <div className="hidden md:flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200">
          <a
            href="#playground"
            className="px-3.5 py-1.5 rounded-full hover:bg-slate-900/5 dark:hover:bg-white/10 hover:text-slate-950 dark:hover:text-white transition-all hover:backdrop-blur-sm"
          >
            Sandbox Terminal
          </a>
          <a
            href="#workflow"
            className="px-3.5 py-1.5 rounded-full hover:bg-slate-900/5 dark:hover:bg-white/10 hover:text-slate-950 dark:hover:text-white transition-all hover:backdrop-blur-sm"
          >
            The Loop
          </a>
          <a
            href="https://github.com/bugHunterYash/BlastRadius-"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-1.5 rounded-full hover:bg-slate-900/5 dark:hover:bg-white/10 hover:text-slate-950 dark:hover:text-white transition-all hover:backdrop-blur-sm flex items-center gap-1.5"
          >
            <GitBranch className="h-3.5 w-3.5 text-purple-500" />
            <span>GitHub</span>
          </a>
        </div>

        {/* Right Actions: Frosted Glass Switcher & High-Contrast "TRY IT" CTA */}
        <div className="flex items-center gap-2.5">
          {/* Theme Switcher Button with reserved layout size */}
          <div className="w-8 h-8 flex items-center justify-center">
            {mounted && (
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="Toggle theme"
                className="h-8 w-8 rounded-full bg-slate-900/5 dark:bg-white/10 hover:bg-slate-900/10 dark:hover:bg-white/20 border border-slate-900/10 dark:border-white/15 flex items-center justify-center transition-all text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {theme === "dark" ? <Sun className="h-3.5 w-3.5 text-amber-300" /> : <Moon className="h-3.5 w-3.5 text-slate-700" />}
              </button>
            )}
          </div>

          {/* Google sign-in, then back to the dashboard */}
          <Link
            href="/login?callbackUrl=%2Fdashboard"
            className="hidden sm:inline-flex px-3.5 py-1.5 rounded-full text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-900/5 dark:hover:bg-white/10 transition-all shrink-0"
          >
            Log in
          </Link>

          {/* High-Contrast "TRY IT" CTA Button */}
          <Link
            href="/dashboard"
            className="px-5 py-2 rounded-full bg-slate-950 hover:bg-slate-800 dark:bg-emerald-400 dark:hover:bg-emerald-300 text-white dark:text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-lg shadow-slate-950/20 dark:shadow-emerald-500/30 hover:scale-[1.04] active:scale-[0.97] transition-all cursor-pointer shrink-0 border border-slate-800 dark:border-emerald-300"
          >
            <Zap className="h-3.5 w-3.5 fill-current text-amber-400 dark:text-slate-950" />
            <span>TRY IT</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </motion.nav>
    </header>
  )
}
