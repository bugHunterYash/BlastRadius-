import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Reveal, SectionHead } from "../components/Reveal";

type Line = { text: string; cls?: string; typed?: boolean };

const SCRIPT: Line[] = [
  { text: "$ blastx scan", cls: "text-white", typed: true },
  { text: "✓ found docker-compose.yml · 5 services", cls: "text-ok" },
  { text: "✓ 9/9 safety checks passed", cls: "text-ok" },
  { text: "  breaking redis…  ramping traffic 1× → 10×…", cls: "text-ink-400" },
  { text: "" },
  { text: "Resilience score  42 / 100", cls: "text-white" },
  { text: "✕ cart breaks when redis is down     91% fail", cls: "text-bad" },
  { text: "! checkout slows at 200 users/sec    p95 742ms", cls: "text-warn" },
  { text: "✓ products fine", cls: "text-ok" },
  { text: "" },
  { text: "$ blastx fix --all", cls: "text-white", typed: true },
  { text: "✦ 2 patches ready · review with: git diff blastx/fixes", cls: "text-blast" },
];

function Terminal() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-120px" });
  const [shown, setShown] = useState(0);
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (!seen || shown >= SCRIPT.length) return;
    const line = SCRIPT[shown];
    if (line.typed && chars < line.text.length) {
      const t = setTimeout(() => setChars((c) => c + 1), 45);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setShown((s) => s + 1);
      setChars(0);
    }, line.typed ? 350 : 230);
    return () => clearTimeout(t);
  }, [seen, shown, chars]);

  return (
    <div ref={ref} className="glass h-full overflow-hidden rounded-[24px]">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-white/10" />
        <span className="h-3 w-3 rounded-full bg-white/10" />
        <span className="h-3 w-3 rounded-full bg-white/10" />
        <span className="ml-2 font-mono text-xs text-ink-500">~/demo-shop</span>
      </div>
      <div className="min-h-[340px] p-5 font-mono text-[13px] leading-7" aria-label="Example terminal session">
        {SCRIPT.slice(0, shown + 1).map((l, i) => {
          const current = i === shown;
          const text = current && l.typed ? l.text.slice(0, chars) : current ? "" : l.text;
          if (current && !l.typed) return null;
          return (
            <div key={i} className={`whitespace-pre ${l.cls ?? ""}`}>
              {text || " "}
              {current && <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-ink-200" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniDashboard() {
  const rows = [
    ["Cart", "Breaks", "bg-bad", "91% fail"],
    ["Checkout", "Slow at 200/s", "bg-warn", "p95 742ms"],
    ["Products", "Fine", "bg-ok", "no change"],
  ];
  return (
    <div className="glass h-full overflow-hidden rounded-[24px]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
        <span className="text-sm font-semibold text-white">localhost:7777</span>
        <span className="text-xs text-ink-500">dashboard</span>
      </div>
      <div className="p-6">
        <div className="text-sm text-ink-400">What if redis goes down?</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight text-white">
          2 of 3 features broke. <span className="text-ink-300">Recovered in 6.2s.</span>
        </div>
        <div className="mt-6 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07]">
          {rows.map(([name, st, dot, d], i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, x: 12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + i * 0.12 }}
              className="flex items-center gap-3 px-4 py-3.5 text-sm"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              <span className="w-24 font-medium text-white">{name}</span>
              <span className="flex-1 text-ink-300">{st}</span>
              <span className="font-mono text-xs text-ink-500">{d}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-950">Show me the fix</span>
          <span className="rounded-full border border-white/10 px-4 py-2 text-sm text-ink-200">Re-test</span>
        </div>
      </div>
    </div>
  );
}

export function Surfaces() {
  return (
    <section className="mx-auto mt-40 max-w-page px-5">
      <SectionHead
        eyebrow="CLI + dashboard"
        center
        title={
          <>
            <span className="chrome-text">Terminal or browser.</span>{" "}
            <span className="chrome-text-soft">Same engine.</span>
          </>
        }
        sub="Live in the terminal like a modern dev tool, or open the dashboard to watch it happen. Both read the same results."
      />
      <div className="mt-14 grid gap-5 lg:grid-cols-2">
        <Reveal><Terminal /></Reveal>
        <Reveal delay={0.1}><MiniDashboard /></Reveal>
      </div>
    </section>
  );
}
