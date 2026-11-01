import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { Github, Menu, X } from "lucide-react";
import { useState } from "react";
import { Logo } from "../components/Logo";

export const REPO_URL = "https://github.com/bugHunterYash/BlastRadius-";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#product", label: "Product" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#pricing", label: "Pricing" },
  { href: "#install", label: "Docs" },
];

export function Navbar() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <motion.nav
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`flex w-full max-w-page items-center justify-between rounded-2xl border px-4 py-2.5 transition-all duration-300 ${
          scrolled
            ? "border-white/10 bg-ink-900/75 shadow-2xl shadow-black/50 backdrop-blur-xl"
            : "border-transparent bg-transparent"
        }`}
        aria-label="Main"
      >
        <a href="#top" aria-label="BlastRadius home">
          <Logo />
        </a>
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-1.5 text-sm text-ink-300 transition hover:bg-white/5 hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-ink-300 transition hover:text-white"
          >
            <Github size={16} /> GitHub
          </a>
          <a
            href="#install"
            className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-ink-950 transition hover:bg-ink-200"
          >
            Get started
          </a>
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-ink-200 md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </motion.nav>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute inset-x-4 top-20 rounded-2xl border border-white/10 bg-ink-900/95 p-3 backdrop-blur-xl md:hidden"
          >
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-ink-200 hover:bg-white/5"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#install"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-xl bg-white px-3 py-2.5 text-center font-semibold text-ink-950"
            >
              Get started
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
