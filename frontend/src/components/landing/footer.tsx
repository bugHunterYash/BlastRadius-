"use client"

import React from "react"
import Link from "next/link"
import { GitBranch } from "lucide-react"

export function Footer() {
  return (
    <footer className="relative py-10 px-4 max-w-4xl mx-auto">
      <div className="modern-card p-4 sm:p-5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Brand & Attribution */}
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center text-[10px] font-bold">
            BR
          </div>
          <span className="font-bold text-sm text-slate-900 dark:text-white">
            Blast<span className="text-purple-600 dark:text-purple-400">Radius</span>
          </span>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            CBS 9.0 (₹0 Stack)
          </span>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Control Plane: 127.0.0.1</span>
        </div>

        {/* Links */}
        <div className="flex items-center gap-3 text-xs font-medium">
          <a
            href="https://github.com/bugHunterYash/BlastRadius-"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-purple-600 transition-colors"
          >
            <GitBranch className="h-3.5 w-3.5 text-purple-500" />
            <span>GitHub</span>
          </a>
          <Link
            href="/tower"
            className="px-3 py-1 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            App →
          </Link>
        </div>
      </div>
    </footer>
  )
}
