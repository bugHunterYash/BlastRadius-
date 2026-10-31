import { motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useRef } from "react";
import { ChromeStar } from "../components/ChromeStar";
import { CopyCommand } from "../components/CopyCommand";
import { HeroScan } from "./HeroScan";

const LINE_1 = ["Know", "how", "your", "app", "breaks."];
const LINE_2 = ["Before", "your", "users", "do."];

function Words({ words, start, className, hot }: { words: string[]; start: number; className: string; hot?: string }) {
  return (
    <span className="block">
      {words.map((w, i) => (
        <motion.span
          key={w + i}
          className={`inline-block pr-[0.22em] ${w === hot ? "blast-text" : className}`}
          initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.7, delay: start + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
        >
          {w}
        </motion.span>
      ))}
    </span>
  );
}

export function Hero() {
  const visualRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: visualRef, offset: ["start end", "start 30%"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [22, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);

  // Parallax: stars drift up faster than the page, the copy fades as you leave.
  const { scrollY } = useScroll();
  const starsY = useTransform(scrollY, [0, 800], [0, -260]);
  const starsYSlow = useTransform(scrollY, [0, 800], [0, -120]);
  const copyOpacity = useTransform(scrollY, [0, 500], [1, 0.25]);

  // Glow that follows the cursor across the hero.
  const mx = useMotionValue(-1000);
  const my = useMotionValue(-1000);
  const glowX = useSpring(mx, { stiffness: 120, damping: 20 });
  const glowY = useSpring(my, { stiffness: 120, damping: 20 });

  return (
    <section
      id="top"
      ref={sectionRef}
      onMouseMove={(e) => {
        const r = sectionRef.current?.getBoundingClientRect();
        if (!r) return;
        mx.set(e.clientX - r.left - 300);
        my.set(e.clientY - r.top - 300);
      }}
      className="relative overflow-hidden pt-36 md:pt-44"
    >
      <div aria-hidden="true" className="grid-bg fade-mask absolute inset-0 h-[900px]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="aurora absolute left-[8%] top-[-120px] h-[520px] w-[620px] rounded-full bg-blast/30 blur-[130px]" />
        <div className="aurora-slow absolute right-[-5%] top-[60px] h-[480px] w-[560px] rounded-full bg-[#5b7cff]/25 blur-[130px]" />
        <div className="aurora absolute left-[40%] top-[380px] h-[360px] w-[420px] rounded-full bg-[#ff3d6e]/15 blur-[120px]" />
      </div>
      <motion.div
        aria-hidden="true"
        style={{ x: glowX, y: glowY }}
        className="pointer-events-none absolute left-0 top-0 h-[600px] w-[600px] rounded-full bg-white/[0.07] blur-[90px]"
      />

      <motion.div style={{ opacity: copyOpacity }} className="relative mx-auto max-w-page px-5">
        <motion.div style={{ y: starsY }} className="absolute inset-0">
          <ChromeStar size={200} className="right-[4%] top-[-30px] hidden md:block" delay={0.4} />
          <ChromeStar size={54} className="left-[2%] top-[260px] hidden lg:block" delay={1} />
        </motion.div>
        <motion.div style={{ y: starsYSlow }} className="absolute inset-0">
          <ChromeStar size={84} className="right-[22%] top-[150px] hidden md:block" delay={0.7} spin={-14} />
        </motion.div>

        <motion.a
          href="#how"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 text-sm text-ink-200 backdrop-blur hover:border-white/20"
        >
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink-950">New</span>
          Auto Risk Scan: the AI finds your weak spots for you
          <ArrowRight size={14} className="text-ink-400" />
        </motion.a>

        <h1 className="mt-7 max-w-4xl text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl md:text-[84px]">
          <Words words={LINE_1} start={0.1} className="chrome-text" hot="breaks." />
          <Words words={LINE_2} start={0.45} className="chrome-text-soft" />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.85 }}
          className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-300 md:text-xl"
        >
          BlastRadius is an <span className="text-white">AI reliability engineer</span> for teams that
          don't have one. It finds how your app will fail, breaks it safely to prove it, writes the fix,
          and re-tests until the risk is gone. No chaos-engineering degree required.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1 }}
          className="mt-9 flex flex-wrap items-center gap-3"
        >
          <CopyCommand command="npm install -g blastx" />
          <a
            href="#waitlist"
            className="btn-shine group inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-ink-950 transition hover:scale-[1.03]"
          >
            Join the Pro waitlist
            <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.2 }}
          className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-400"
        >
          <span>Open source</span>
          <span>Runs on your laptop</span>
          <span>Works with Docker Compose</span>
          <span>₹0 to start</span>
        </motion.div>
      </motion.div>

      <div ref={visualRef} className="relative mx-auto mt-20 max-w-page px-5 [perspective:1600px]">
        <div aria-hidden="true" className="absolute inset-x-[10%] top-10 h-[70%] rounded-full bg-blast/20 blur-[120px]" />
        <motion.div style={{ rotateX, scale, transformOrigin: "50% 0%" }} className="relative">
          <HeroScan />
        </motion.div>
        <p className="mt-4 text-center text-xs text-ink-500">Example scan of a demo shop app. Your numbers come from your own run.</p>
      </div>
    </section>
  );
}
