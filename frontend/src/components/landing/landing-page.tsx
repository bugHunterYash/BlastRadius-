"use client"

import React from "react"
import { PixelBackground } from "./pixel-background"
import { Navbar } from "./navbar"
import { HeroSection } from "./hero-section"
import { PixelPlayground } from "./pixel-playground"
import { WorkflowStrip } from "./workflow-strip"
import { Quickstart } from "./quickstart"
import { Footer } from "./footer"

export function LandingPage() {
  return (
    <div className="relative min-h-screen text-slate-900 dark:text-slate-100 pixel-canvas-bg selection:bg-purple-500/20 selection:text-purple-900 overflow-x-hidden">
      {/* Retro Pixel Canvas Background */}
      <PixelBackground />

      {/* Movable Tactile Navbar */}
      <Navbar />

      {/* Main Streamlined Content Flow (Antigravity & Codex Clean Minimalist Style) */}
      <main className="relative z-10 flex flex-col gap-6">
        <HeroSection />
        <PixelPlayground />
        <WorkflowStrip />
        <Quickstart />
      </main>

      {/* Minimalist Retro Footer */}
      <Footer />
    </div>
  )
}
