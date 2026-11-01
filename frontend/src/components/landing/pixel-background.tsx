"use client"

import React, { useEffect, useState } from "react"

interface PixelStar {
  id: number
  top: number
  left: number
  delay: number
  size: number
  color: string
}

const STAR_COLORS = [
  "#f43f5e", // Hot Pink
  "#facc15", // Arcade Yellow
  "#38bdf8", // Sky Blue
  "#22c55e", // Neon Green
  "#a855f7", // Retro Violet
  "#fb923c", // Warm Orange
]

export function PixelBackground() {
  const [mounted, setMounted] = useState(false)
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 })
  const [stars, setStars] = useState<PixelStar[]>([])

  useEffect(() => {
    setMounted(true)
    const generatedStars = Array.from({ length: 42 }).map((_, i) => ({
      id: i,
      top: ((i * 27) % 90) + 5,
      left: ((i * 41) % 94) + 3,
      delay: (i % 7) * 0.4,
      size: i % 4 === 0 ? 5 : i % 2 === 0 ? 3.5 : 2.5,
      color: STAR_COLORS[i % STAR_COLORS.length],
    }))
    setStars(generatedStars)

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none transition-colors duration-500">
      {/* Interactive Mouse Spotlight Illuminating the Bolder Darker Grid */}
      {mounted && (
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-300 opacity-100"
          style={{
            background: `radial-gradient(650px circle at ${mousePos.x}px ${mousePos.y}px, rgba(124, 58, 237, 0.08), rgba(56, 189, 248, 0.04) 45%, transparent 75%)`,
          }}
        />
      )}

      {/* Top Retro Pixel Gradient Header Bar */}
      <div className="absolute top-0 left-0 right-0 h-44 sm:h-56 opacity-50 dark:opacity-40 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-500/15 via-pink-400/10 to-transparent" />

        {/* 8-bit Pixel Clouds Drift */}
        <div className="absolute top-6 left-12 animate-float-slow opacity-70">
          <svg width="64" height="24" viewBox="0 0 64 24" fill="currentColor" className="text-purple-400/80 dark:text-purple-300/70 pixelated">
            <rect x="16" y="0" width="32" height="8" />
            <rect x="8" y="8" width="48" height="8" />
            <rect x="0" y="16" width="64" height="8" />
          </svg>
        </div>

        <div className="absolute top-8 right-24 animate-float-medium opacity-65" style={{ animationDelay: "2.5s" }}>
          <svg width="52" height="20" viewBox="0 0 52 20" fill="currentColor" className="text-pink-400/80 dark:text-pink-300/70 pixelated">
            <rect x="14" y="0" width="24" height="6" />
            <rect x="6" y="6" width="40" height="6" />
            <rect x="0" y="12" width="52" height="8" />
          </svg>
        </div>
      </div>

      {/* =========================================================================
          Project-Related Pixel Elements Floating at Diverse Depths & Color Schemes
          ========================================================================= */}

      {/* 1. Docker Whale (Cyan / Blue - Medium - Top Left) */}
      <div className="absolute top-[16%] left-[3%] animate-pixel-bob opacity-80 hover:opacity-100 transition-opacity hidden md:block">
        <div className="group relative">
          <svg width="48" height="32" viewBox="0 0 24 16" fill="none" className="pixelated drop-shadow-md">
            {/* Whale body */}
            <rect x="4" y="8" width="14" height="6" fill="#0284c7" />
            <rect x="18" y="10" width="4" height="4" fill="#0284c7" />
            <rect x="2" y="10" width="4" height="4" fill="#0284c7" />
            {/* Containers on back */}
            <rect x="6" y="4" width="3" height="3" fill="#38bdf8" />
            <rect x="10" y="4" width="3" height="3" fill="#facc15" />
            <rect x="14" y="4" width="3" height="3" fill="#f43f5e" />
            {/* Eye */}
            <rect x="6" y="10" width="2" height="2" fill="#0f172a" />
            <rect x="6" y="10" width="1" height="1" fill="#ffffff" />
          </svg>
        </div>
      </div>

      {/* 2. Redis Ruby Gem (Vibrant Red - Small - Top Right) */}
      <div className="absolute top-[14%] right-[4%] animate-pixel-sway opacity-85 hidden md:block" style={{ animationDelay: "0.8s" }}>
        <svg width="34" height="34" viewBox="0 0 16 16" fill="none" className="pixelated drop-shadow-md">
          <rect x="4" y="2" width="8" height="2" fill="#f43f5e" />
          <rect x="2" y="4" width="12" height="4" fill="#ef4444" />
          <rect x="4" y="8" width="8" height="4" fill="#dc2626" />
          <rect x="6" y="12" width="4" height="2" fill="#991b1b" />
          {/* Sparkle glint */}
          <rect x="6" y="4" width="2" height="2" fill="#ffffff" />
        </svg>
      </div>

      {/* 3. PostgreSQL Database Cylinder (Sapphire / Indigo - Medium - Mid Right) */}
      <div className="absolute top-[42%] right-[3.5%] animate-pixel-bob opacity-80 hidden lg:block" style={{ animationDelay: "1.8s" }}>
        <svg width="40" height="40" viewBox="0 0 16 16" fill="none" className="pixelated drop-shadow-md">
          {/* Top disc */}
          <rect x="3" y="1" width="10" height="3" fill="#4f46e5" />
          <rect x="4" y="1" width="8" height="1" fill="#818cf8" />
          {/* Mid section 1 */}
          <rect x="3" y="5" width="10" height="3" fill="#3730a3" />
          <rect x="4" y="6" width="2" height="1" fill="#34d399" /> {/* Green LED */}
          {/* Mid section 2 */}
          <rect x="3" y="9" width="10" height="3" fill="#312e81" />
          <rect x="4" y="10" width="2" height="1" fill="#38bdf8" /> {/* Blue LED */}
          {/* Base */}
          <rect x="3" y="13" width="10" height="2" fill="#1e1b4b" />
        </svg>
      </div>

      {/* 4. Circuit Breaker / Lightning Spark (Electric Gold - Small - Mid Left) */}
      <div className="absolute top-[38%] left-[4.5%] animate-pixel-sway opacity-85 hidden md:block" style={{ animationDelay: "1.2s" }}>
        <svg width="32" height="36" viewBox="0 0 12 16" fill="none" className="pixelated drop-shadow-md">
          <rect x="6" y="1" width="3" height="4" fill="#facc15" />
          <rect x="4" y="5" width="4" height="3" fill="#eab308" />
          <rect x="2" y="8" width="7" height="2" fill="#fde047" />
          <rect x="3" y="10" width="4" height="3" fill="#eab308" />
          <rect x="4" y="13" width="2" height="3" fill="#ca8a04" />
        </svg>
      </div>

      {/* 5. Chaos Bug Invader 👾 (Neon Violet - Medium - Bottom Left) */}
      <div className="absolute top-[72%] left-[5%] animate-pixel-sway opacity-75 hidden md:block" style={{ animationDelay: "2.2s" }}>
        <svg width="40" height="36" viewBox="0 0 16 14" fill="none" className="pixelated drop-shadow-md">
          <rect x="4" y="2" width="8" height="6" fill="#a855f7" />
          <rect x="2" y="4" width="12" height="4" fill="#9333ea" />
          <rect x="2" y="8" width="2" height="4" fill="#7e22ce" />
          <rect x="12" y="8" width="2" height="4" fill="#7e22ce" />
          <rect x="6" y="10" width="4" height="3" fill="#7e22ce" />
          {/* Eyes */}
          <rect x="4" y="4" width="2" height="2" fill="#facc15" />
          <rect x="10" y="4" width="2" height="2" fill="#facc15" />
        </svg>
      </div>

      {/* 6. Terminal Prompt Box `>_` (Matrix Green - Small - Bottom Right) */}
      <div className="absolute top-[68%] right-[6%] animate-pixel-bob opacity-80 hidden md:block" style={{ animationDelay: "1.4s" }}>
        <svg width="36" height="30" viewBox="0 0 16 12" fill="none" className="pixelated drop-shadow-md">
          <rect x="0" y="0" width="16" height="12" fill="#0f172a" />
          <rect x="1" y="1" width="14" height="10" fill="#020408" />
          {/* Prompt arrow & cursor */}
          <rect x="3" y="4" width="2" height="1" fill="#22c55e" />
          <rect x="4" y="5" width="2" height="1" fill="#22c55e" />
          <rect x="3" y="6" width="2" height="1" fill="#22c55e" />
          <rect x="8" y="4" width="3" height="4" fill="#22c55e" className="animate-pulse" />
        </svg>
      </div>

      {/* 7. ₹0 Golden Stack Coin (Golden Amber - Small - Top Center-Right) */}
      <div className="absolute top-[11%] right-[22%] animate-pixel-bob opacity-85 hidden sm:block" style={{ animationDelay: "0.5s" }}>
        <svg width="30" height="30" viewBox="0 0 14 14" fill="none" className="pixelated drop-shadow-sm">
          <rect x="3" y="1" width="8" height="12" fill="#eab308" />
          <rect x="1" y="3" width="12" height="8" fill="#eab308" />
          <rect x="2" y="2" width="10" height="10" fill="#facc15" />
          <rect x="4" y="4" width="6" height="6" fill="#fef08a" />
          {/* Inner ₹ coin bar */}
          <rect x="5" y="5" width="4" height="1" fill="#854d0e" />
          <rect x="5" y="7" width="3" height="1" fill="#854d0e" />
        </svg>
      </div>

      {/* 8. CPU Heat Flame 🔥 (Warm Orange/Red - Small - Center-Left) */}
      <div className="absolute top-[55%] left-[2%] animate-pixel-sway opacity-75 hidden xl:block" style={{ animationDelay: "1.9s" }}>
        <svg width="28" height="32" viewBox="0 0 12 14" fill="none" className="pixelated drop-shadow-sm">
          <rect x="4" y="1" width="4" height="3" fill="#f97316" />
          <rect x="2" y="4" width="8" height="4" fill="#ea580c" />
          <rect x="3" y="8" width="6" height="4" fill="#c2410c" />
          <rect x="5" y="4" width="2" height="4" fill="#fde047" /> {/* Inner yellow flame */}
        </svg>
      </div>

      {/* 9. Floating 8-Bit Pixel UFO Sprite (Pastel Multi-Color - Center Top) */}
      <div className="absolute top-10 left-1/3 animate-pixel-sway opacity-85">
        <svg width="42" height="22" viewBox="0 0 40 20" fill="none" className="pixelated drop-shadow-md">
          <rect x="16" y="0" width="8" height="4" fill="#38bdf8" />
          <rect x="8" y="4" width="24" height="6" fill="#facc15" stroke="#0f172a" strokeWidth="1.5" />
          <rect x="4" y="10" width="32" height="6" fill="#f43f5e" stroke="#0f172a" strokeWidth="1.5" />
          <rect x="8" y="16" width="4" height="4" fill="#22c55e" />
          <rect x="28" y="16" width="4" height="4" fill="#22c55e" />
        </svg>
      </div>

      {/* Floating Colorful 8-Bit Twinkling Pixel Stars */}
      {mounted && stars.map((s) => (
        <div
          key={s.id}
          className="absolute pixelated"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            backgroundColor: s.color,
            boxShadow: `0 0 6px ${s.color}`,
            animation: `ambient-glow 2.5s ease-in-out infinite`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}

      {/* Bottom Ambient Soft Fade */}
      <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-slate-200/40 dark:from-[#050810] to-transparent" />
    </div>
  )
}
