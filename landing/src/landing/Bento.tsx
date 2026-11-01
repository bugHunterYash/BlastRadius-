import { motion, useInView } from "framer-motion";
import { Check, IndianRupee } from "lucide-react";
import { useRef } from "react";
import { Reveal, SectionHead } from "../components/Reveal";
import { ScoreRing } from "../components/ScoreRing";
import { Spotlight } from "../components/Spotlight";

function CardTitle({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-xl font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-2 leading-relaxed text-ink-300">{body}</p>
    </div>
  );
}

function ScoreCard() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-100px" });
  return (
    <Spotlight className="h-full p-8">
      <div ref={ref} className="flex h-full flex-col justify-between gap-8 sm:flex-row sm:items-center">
        <CardTitle
          title="One number your whole team understands"
          body="The Resilience Score counts how many real failure scenarios your important pages survive, plus your traffic headroom. Every point traces back to a measured test."
        />
        <div className="flex items-center gap-5">
          <div className="text-center">
            <ScoreRing value={seen ? 42 : 0} size={116} />
            <div className="mt-2 text-xs text-ink-400">before</div>
          </div>
          <span className="text-2xl text-ink-500">→</span>
          <div className="text-center">
            <ScoreRing value={seen ? 81 : 0} size={116} />
            <div className="mt-2 text-xs text-ink-400">after fixes</div>
          </div>
        </div>
      </div>
    </Spotlight>
  );
}

function RupeeCard() {
  return (
    <Spotlight className="h-full p-8">
      <CardTitle title="Risk in rupees, not jargon" body="Tell it what a minute of checkout is worth. Findings come back as money at risk." />
      <div className="mt-7 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 text-sm text-bad">
          <span className="h-2 w-2 rounded-full bg-bad" /> Cart stops working
        </div>
        <div className="mt-3 flex items-baseline gap-1 text-3xl font-semibold text-white">
          <IndianRupee size={22} className="self-center" />
          50,000
          <span className="ml-1 text-sm font-normal text-ink-400">per 10 min outage</span>
        </div>
        <div className="mt-2 text-xs text-ink-500">from your value: ₹5,000 / min of checkout</div>
      </div>
    </Spotlight>
  );
}

const STEPS = [
  { x: "1×", rps: "20/s", h: 22, ok: true },
  { x: "2×", rps: "40/s", h: 34, ok: true },
  { x: "5×", rps: "100/s", h: 56, ok: true },
  { x: "10×", rps: "200/s", h: 92, ok: false },
];

function BreakingPointCard() {
  return (
    <Spotlight className="h-full p-8">
      <CardTitle title="Find your breaking point" body="Traffic steps up until something gives. Arrivals don't wait for the server, just like real users." />
      <div className="mt-7 flex h-40 items-end gap-4">
        {STEPS.map((s, i) => (
          <div key={s.x} className="flex flex-1 flex-col items-center gap-2">
            <motion.div
              initial={{ height: 0 }}
              whileInView={{ height: `${s.h}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: i * 0.15, ease: [0.22, 1, 0.36, 1] }}
              className={`w-full rounded-t-lg ${s.ok ? "bg-gradient-to-t from-ink-600 to-ink-300" : "bg-gradient-to-t from-bad/40 to-bad"}`}
            />
            <div className="text-xs font-semibold text-ink-200">{s.x}</div>
            <div className="font-mono text-[10px] text-ink-500">{s.rps}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-sm text-ink-200">
        Safe up to <span className="text-white">100 users/sec</span> · slows at 200
      </div>
    </Spotlight>
  );
}

const DIFF = [
  { t: "-cart = redis.get(key)", c: "text-bad" },
  { t: "+try:", c: "text-ok" },
  { t: "+    cart = redis.get(key, timeout=0.2)", c: "text-ok" },
  { t: "+except RedisError:", c: "text-ok" },
  { t: "+    cart = db.load_cart(user_id)", c: "text-ok" },
];

function FixCard() {
  return (
    <Spotlight className="h-full p-8">
      <CardTitle title="The AI writes the fix" body="Not advice. A reviewable code change, tied to the evidence that motivated it." />
      <div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900 p-4 font-mono text-[12.5px] leading-6">
        <div className="mb-2 text-ink-500">api/cart.py</div>
        {DIFF.map((l, i) => (
          <motion.div
            key={l.t}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.12 }}
            className={`whitespace-pre ${l.c}`}
          >
            {l.t}
          </motion.div>
        ))}
      </div>
    </Spotlight>
  );
}

const SAFETY = [
  "Only breaks containers you labelled as test",
  "Refuses anything that looks like production",
  "Hard caps on traffic, users and duration",
  "Kill switch in the terminal and the browser",
  "Every service restored, even after a crash",
];

function SafetyCard() {
  return (
    <Spotlight className="h-full p-8">
      <CardTitle title="Safe by design" body="Breaking things on purpose needs guardrails. These are on by default and can't be skipped." />
      <ul className="mt-6 space-y-3">
        {SAFETY.map((s, i) => (
          <motion.li
            key={s}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="flex items-start gap-3 text-[15px] text-ink-200"
          >
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ok/15">
              <Check size={12} className="text-ok" />
            </span>
            {s}
          </motion.li>
        ))}
      </ul>
    </Spotlight>
  );
}

function EvidenceCard() {
  const pts = "0,88 60,86 120,87 150,86 160,14 230,12 300,13 320,60 340,85 420,87 500,86";
  return (
    <Spotlight className="h-full p-8">
      <div className="flex h-full flex-col gap-8 md:flex-row md:items-center">
        <div className="md:w-[42%]">
          <CardTitle
            title="Evidence, not vibes"
            body="Before and during the failure are compared with proper statistics. Only real, significant changes become findings, and the AI can't quote a number it didn't read from a test."
          />
          <div className="mt-5 flex flex-wrap gap-2 font-mono text-xs">
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-ink-200">n = 412</span>
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-ink-200">p &lt; 0.001</span>
            <span className="rounded-md border border-bad/30 bg-bad/10 px-2 py-1 text-bad">0.2% → 91%</span>
          </div>
        </div>
        <div className="flex-1">
          <svg viewBox="0 0 500 100" className="w-full" aria-label="Error rate jumps while redis is down, then recovers">
            <rect x="155" y="0" width="160" height="100" fill="#f87171" opacity="0.08" />
            <text x="235" y="96" textAnchor="middle" fontSize="10" fill="#f87171">redis down</text>
            <motion.polyline
              points={pts}
              fill="none"
              stroke="#f87171"
              strokeWidth="2.5"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.8, ease: "easeInOut" }}
            />
          </svg>
        </div>
      </div>
    </Spotlight>
  );
}

export function Bento() {
  return (
    <section id="product" className="mx-auto mt-40 max-w-page scroll-mt-28 px-5">
      <SectionHead
        eyebrow="Product"
        title={
          <>
            <span className="chrome-text">Everything an SRE would do.</span>
            <br />
            <span className="blast-text">In one command.</span>
          </>
        }
      />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        <Reveal className="md:col-span-2"><ScoreCard /></Reveal>
        <Reveal delay={0.1}><RupeeCard /></Reveal>
        <Reveal><BreakingPointCard /></Reveal>
        <Reveal delay={0.1}><FixCard /></Reveal>
        <Reveal delay={0.2}><SafetyCard /></Reveal>
        <Reveal className="md:col-span-3"><EvidenceCard /></Reveal>
      </div>
    </section>
  );
}
