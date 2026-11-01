import { motion } from "framer-motion";
import { ChromeStar } from "../components/ChromeStar";
import { CopyCommand } from "../components/CopyCommand";
import { Logo } from "../components/Logo";
import { REPO_URL } from "./Navbar";

const COLS = [
  { title: "Product", links: [["How it works", "#how"], ["Features", "#product"], ["Pricing", "#pricing"]] },
  { title: "Developers", links: [["Get started", "#install"], ["GitHub", REPO_URL], ["Use cases", "#use-cases"]] },
];

export function FinalCta() {
  return (
    <section className="relative mx-auto mt-44 max-w-page px-5 text-center">
      <div aria-hidden="true" className="aurora absolute left-1/2 top-0 h-80 w-[640px] -translate-x-1/2 rounded-full bg-blast/25 blur-[130px]" />
      <ChromeStar size={110} className="left-[8%] top-[-20px] hidden md:block" />
      <ChromeStar size={64} className="right-[10%] top-[60px] hidden md:block" delay={0.6} spin={-12} />
      <motion.h2
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-4xl text-5xl font-semibold leading-[1.02] tracking-[-0.035em] md:text-[80px]"
      >
        <span className="chrome-text">Break it before</span>
        <br />
        <span className="blast-text">production does.</span>
      </motion.h2>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <CopyCommand command="npm install -g blastx" />
        <a href="#waitlist" className="btn-shine rounded-full px-6 py-3 text-sm font-semibold text-ink-950 transition hover:scale-[1.03]">
          Join the Pro waitlist
        </a>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="mt-40 border-t border-white/[0.07]">
      <div className="mx-auto flex max-w-page flex-col gap-12 px-5 py-14 md:flex-row md:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-ink-400">
            The AI reliability engineer for teams that don't have one.
          </p>
        </div>
        <div className="flex gap-16">
          {COLS.map((c) => (
            <div key={c.title}>
              <div className="text-sm font-semibold text-white">{c.title}</div>
              <ul className="mt-4 space-y-2.5 text-sm text-ink-400">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="hover:text-white" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="relative mx-auto max-w-page overflow-hidden px-5">
        <div
          aria-hidden="true"
          className="select-none whitespace-nowrap text-center text-[17vw] font-bold leading-[0.8] tracking-[-0.05em] text-transparent lg:text-[220px]"
          style={{
            WebkitTextStroke: "1px rgba(255,255,255,0.14)",
            WebkitMaskImage: "linear-gradient(180deg, #000 20%, transparent 95%)",
            maskImage: "linear-gradient(180deg, #000 20%, transparent 95%)",
          }}
        >
          BlastRadius
        </div>
      </div>
      <div className="mx-auto flex max-w-page flex-col justify-between gap-2 px-5 pb-10 pt-6 text-xs text-ink-500 md:flex-row">
        <span>© 2026 BlastRadius · Built at CBS 9.0</span>
        <span>Test only systems you own, in environments made for testing.</span>
      </div>
    </footer>
  );
}
