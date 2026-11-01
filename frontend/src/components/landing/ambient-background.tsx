"use client"

import React from "react"
import { motion } from "motion/react"

export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none">
      {/* Base Canvas Gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#8db8ff] via-[#b6d5ff] to-[#f0f6ff] dark:from-[#070b14] dark:via-[#0c1424] dark:to-[#050811] transition-colors duration-700" />

      {/* Ambient Radial Glows */}
      <div className="absolute -top-[15%] left-[20%] h-[600px] w-[600px] rounded-full bg-blue-300/40 dark:bg-blue-600/15 blur-[120px] animate-ambient-glow" />
      <div className="absolute top-[40%] -left-[10%] h-[700px] w-[700px] rounded-full bg-sky-200/50 dark:bg-cyan-500/10 blur-[140px] animate-ambient-glow" style={{ animationDelay: "2s" }} />
      <div className="absolute -bottom-[20%] right-[10%] h-[800px] w-[800px] rounded-full bg-indigo-200/40 dark:bg-indigo-600/15 blur-[150px] animate-ambient-glow" style={{ animationDelay: "4s" }} />

      {/* SVG Fluid Paper-Cut Waves Layer (Faithful to Inspo Image) */}
      <svg
        className="absolute inset-0 h-full w-full object-cover"
        viewBox="0 0 1600 1000"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Wave Drop Shadows */}
          <filter id="waveShadow1" x="-10%" y="-10%" width="130%" height="130%">
            <feDropShadow dx="-8" dy="16" stdDeviation="24" floodColor="#2563eb" floodOpacity="0.14" />
          </filter>
          <filter id="waveShadow2" x="-10%" y="-10%" width="130%" height="130%">
            <feDropShadow dx="-12" dy="24" stdDeviation="32" floodColor="#1d4ed8" floodOpacity="0.18" />
          </filter>
          <filter id="sphereShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="-8" dy="16" stdDeviation="20" floodColor="#1e3a8a" floodOpacity="0.22" />
          </filter>

          {/* Gradients */}
          <linearGradient id="waveGradWhite" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="65%" stopColor="#f5f8ff" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#dce8fe" stopOpacity="0.75" />
          </linearGradient>

          <linearGradient id="waveGradBlueMid" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#76a8fa" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#5b93f6" stopOpacity="0.95" />
          </linearGradient>

          <linearGradient id="sphereGrad1" x1="25%" y1="20%" x2="80%" y2="85%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="40%" stopColor="#dbe8fe" />
            <stop offset="100%" stopColor="#92bcfd" />
          </linearGradient>

          <linearGradient id="sphereGradDark" x1="25%" y1="20%" x2="80%" y2="85%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="45%" stopColor="#1e40af" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>

          {/* Dark Mode Wave Gradients */}
          <linearGradient id="waveDarkLayer1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="waveDarkLayer2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0e1726" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0.95" />
          </linearGradient>
        </defs>

        {/* Top-Left Crisp Fluid Wave (White Paper Fold from Reference) */}
        <path
          className="transition-colors duration-700 fill-[url(#waveGradWhite)] dark:fill-[url(#waveDarkLayer1)] opacity-95 dark:opacity-40"
          filter="url(#waveShadow1)"
          d="M -100 -50 
             C 250 -40, 480 80, 520 220 
             C 555 340, 420 480, 240 500 
             C 80 520, -50 420, -100 350 Z"
        />

        {/* Massive Dynamic Right Organic Wave (From Reference Image) */}
        <path
          className="transition-colors duration-700 fill-[url(#waveGradWhite)] dark:fill-[url(#waveDarkLayer2)] opacity-95 dark:opacity-50"
          filter="url(#waveShadow2)"
          d="M 1700 -50 
             L 1250 -50 
             C 1120 180, 1180 260, 1080 340 
             C 960 440, 840 430, 820 540 
             C 790 680, 960 760, 1020 860 
             C 1070 940, 1040 1020, 1050 1100 
             L 1700 1100 Z"
        />

        {/* Second Inner Accent Fluid Wave Layer */}
        <path
          className="transition-colors duration-700 fill-[#9ec3fc] dark:fill-[#1e3a8a] opacity-35 dark:opacity-25"
          d="M 1700 120 
             C 1340 180, 1220 320, 1160 480 
             C 1100 640, 1210 760, 1150 920 
             C 1120 1000, 1050 1060, 1000 1100 
             L 1700 1100 Z"
        />

        {/* Bottom-Left Smooth Bubble Curve */}
        <path
          className="transition-colors duration-700 fill-[url(#waveGradWhite)] dark:fill-[url(#waveDarkLayer1)] opacity-95 dark:opacity-40"
          filter="url(#waveShadow1)"
          d="M -50 1050 
             L -50 780 
             C 80 770, 180 820, 220 900 
             C 250 960, 220 1020, 180 1050 Z"
        />

        {/* Floating 3D Orb 1 (Top Center-Right from Reference Image) */}
        <g filter="url(#sphereShadow)" className="animate-float-slow">
          <circle
            cx="1120"
            cy="240"
            r="85"
            className="fill-[url(#sphereGrad1)] dark:fill-[url(#sphereGradDark)] transition-colors duration-700"
          />
          {/* Specular Inner Glint */}
          <ellipse cx="1090" cy="210" rx="36" ry="24" fill="#ffffff" fillOpacity="0.45" />
        </g>

        {/* Floating 3D Orb 2 (Small Center-Left from Reference Image) */}
        <g filter="url(#sphereShadow)" className="animate-float-medium">
          <circle
            cx="730"
            cy="230"
            r="32"
            className="fill-[url(#sphereGrad1)] dark:fill-[url(#sphereGradDark)] transition-colors duration-700"
          />
          <ellipse cx="718" cy="218" rx="14" ry="9" fill="#ffffff" fillOpacity="0.5" />
        </g>

        {/* Floating 3D Orb 3 (Bottom Ambient Orb) */}
        <g filter="url(#sphereShadow)" className="animate-float-reverse">
          <circle
            cx="280"
            cy="860"
            r="44"
            className="fill-[url(#sphereGrad1)] dark:fill-[url(#sphereGradDark)] transition-colors duration-700"
          />
          <ellipse cx="265" cy="845" rx="18" ry="12" fill="#ffffff" fillOpacity="0.4" />
        </g>

        {/* Subtle Tech Grid / Constellation Nodes (Antigravity Inspo) */}
        <g opacity="0.18" className="dark:opacity-10">
          <circle cx="480" cy="380" r="2.5" fill="#1e3a8a" className="dark:fill-white" />
          <circle cx="620" cy="440" r="2" fill="#1e3a8a" className="dark:fill-white" />
          <circle cx="560" cy="580" r="3" fill="#1e3a8a" className="dark:fill-white" />
          <circle cx="940" cy="510" r="2" fill="#1e3a8a" className="dark:fill-white" />
          <line x1="480" y1="380" x2="620" y2="440" stroke="#1e3a8a" strokeWidth="0.75" strokeDasharray="3 3" className="dark:stroke-white" />
          <line x1="620" y1="440" x2="560" y2="580" stroke="#1e3a8a" strokeWidth="0.75" strokeDasharray="3 3" className="dark:stroke-white" />
        </g>
      </svg>

      {/* Subtle Noise Texture for Premium Paper Feel */}
      <div
        className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04] pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  )
}
