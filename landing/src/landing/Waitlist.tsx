import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ChromeStar } from "../components/ChromeStar";
import { Reveal } from "../components/Reveal";
import { ApiError, getStats, joinWaitlist, type Plan, type SiteStats } from "../lib/api";

const PLANS: { id: Plan; label: string }[] = [
  { id: "pro", label: "Pro" },
  { id: "team", label: "Team" },
  { id: "enterprise", label: "Enterprise" },
];

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; position: number; again: boolean }
  | { kind: "error"; message: string };

export function Waitlist({ plan, setPlan }: { plan: Plan; setPlan: (p: Plan) => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [offline, setOffline] = useState(false);

  const loadStats = () =>
    getStats()
      .then((s) => {
        setStats(s);
        setOffline(false);
      })
      .catch(() => setOffline(true));

  useEffect(() => {
    loadStats();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const r = await joinWaitlist(email, plan === "free" ? "pro" : plan);
      setState({ kind: "done", position: r.position, again: r.status === "already_joined" });
      loadStats();
    } catch (err) {
      setState({ kind: "error", message: err instanceof ApiError ? err.message : "Something went wrong." });
    }
  }

  return (
    <section id="waitlist" className="mx-auto mt-40 max-w-page scroll-mt-28 px-5">
      <Reveal>
        <div className="glass relative overflow-hidden rounded-[32px] px-6 py-16 text-center md:px-16">
          <div aria-hidden="true" className="grid-bg fade-mask absolute inset-0 opacity-60" />
          <div aria-hidden="true" className="aurora absolute -left-20 -top-20 h-80 w-96 rounded-full bg-blast/25 blur-[110px]" />
          <div aria-hidden="true" className="aurora-slow absolute -bottom-24 right-0 h-80 w-96 rounded-full bg-[#5b7cff]/20 blur-[110px]" />
          <ChromeStar size={120} className="-right-6 -top-6 hidden md:block" />
          <ChromeStar size={60} className="bottom-8 left-10 hidden md:block" delay={0.5} spin={-12} />

          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-4xl font-semibold tracking-tight md:text-5xl">
              <span className="chrome-text">Get </span>
              <span className="blast-text">Pro</span>
              <span className="chrome-text"> first.</span>
            </h2>
            <p className="mt-4 text-lg text-ink-300">
              Built-in AI, shareable reports and the PR gate are coming next. Join the waitlist and get three months
              free at launch.
            </p>

            <div className="mt-8 flex justify-center gap-2" role="radiogroup" aria-label="Plan">
              {PLANS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={plan === p.id}
                  onClick={() => setPlan(p.id)}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    plan === p.id ? "border-white bg-white text-ink-950" : "border-white/10 text-ink-300 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {state.kind === "done" ? (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mx-auto mt-6 flex max-w-md items-center justify-center gap-3 rounded-2xl border border-ok/30 bg-ok/10 px-5 py-4 text-ok"
                  role="status"
                >
                  <Check size={18} />
                  {state.again ? "You're already on the list" : "You're on the list"} · #{state.position}
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  onSubmit={submit}
                  exit={{ opacity: 0 }}
                  className="mx-auto mt-6 flex max-w-md flex-col gap-2 sm:flex-row"
                >
                  <label htmlFor="wl-email" className="sr-only">
                    Email
                  </label>
                  <input
                    id="wl-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="flex-1 rounded-full border border-white/10 bg-ink-900/80 px-5 py-3 text-white placeholder:text-ink-500 focus:border-white/30 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={state.kind === "sending"}
                    className="btn-shine inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-ink-950 transition hover:scale-[1.03] disabled:opacity-60"
                  >
                    {state.kind === "sending" ? <Loader2 size={16} className="animate-spin" /> : <>Join <ArrowRight size={16} /></>}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>

            {state.kind === "error" && (
              <p className="mt-3 text-sm text-bad" role="alert">
                {state.message}
              </p>
            )}

            <div className="mt-8 text-sm text-ink-500" aria-live="polite">
              {stats ? (
                <>
                  <span className="text-ink-200">{stats.waitlist}</span> on the waitlist ·{" "}
                  <span className="text-ink-200">{stats.experiments}</span> experiments run on this engine
                </>
              ) : offline ? (
                "Live counts appear when the BlastRadius engine is running."
              ) : (
                " "
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
