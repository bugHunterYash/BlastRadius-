import { Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api, hhmmss, type Digest, type Event } from "../api";

export function OpBadge({ op }: { op: string }) {
  const c = op === "write" ? "text-blast" : op === "read" ? "text-accent" : "text-ink-300";
  return <span className={`w-16 shrink-0 font-semibold ${c}`}>{op.toUpperCase()}</span>;
}

export function EventRow({ e, onClick, active }: { e: Event; onClick?: () => void; active?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={`flex gap-3 rounded-md px-2 py-1.5 font-mono text-xs ${onClick ? "cursor-pointer hover:bg-white/[0.05]" : ""} ${active ? "bg-blast/10 ring-1 ring-blast/40" : ""}`}
    >
      <span className="shrink-0 text-ink-500">{hhmmss(e.ts)}</span>
      <span className="w-20 shrink-0 text-ink-200">{e.agent}</span>
      <OpBadge op={e.op} />
      <span className="min-w-0 truncate text-ink-200">
        {e.op === "handoff" ? `→ ${e.target_agent}` : `${e.fact_key} v${e.version}`}
        {e.value_preview && <span className="text-ink-500">  "{e.value_preview}"</span>}
        {e.reason && <span className="text-ink-400">  · {e.reason}</span>}
      </span>
    </div>
  );
}

export function Timeline({ runId, tick }: { runId?: string; tick: number }) {
  const [data, setData] = useState<{ events: Event[]; digests: Digest[] }>({ events: [], digests: [] });
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; model: string } | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    api.timeline(runId).then(setData).catch(() => undefined);
  }, [runId, tick]);

  const ask = async () => {
    if (!q.trim()) return;
    setAsking(true);
    try {
      setAnswer(await api.ask(q, agent));
    } catch (e) {
      setAnswer({ answer: (e as Error).message, model: "error" });
    } finally {
      setAsking(false);
    }
  };

  const digest = data.digests[0];
  return (
    <div className="space-y-4">
      {digest && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.06] p-4">
          <div className="flex items-center gap-2 text-xs text-accent">
            <Sparkles size={13} /> Run digest · {digest.model === "fallback" ? "counted (summarizer off)" : digest.model}
          </div>
          <p className="mt-1.5 text-sm text-white">{digest.summary.headline}</p>
          {digest.summary.notable.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-300">
              {digest.summary.notable.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex flex-wrap gap-2">
        <select value={agent} onChange={(e) => setAgent(e.target.value)} className="rounded-lg border border-white/10 bg-ink-850 px-2 text-sm text-ink-200">
          <option value="">all agents</option>
          {["researcher", "writer", "reviewer", "publisher"].map((a) => <option key={a}>{a}</option>)}
        </select>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="What did the writer change since 5 pm?"
          className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-1.5 text-sm text-white placeholder:text-ink-500 focus:border-accent/50 focus:outline-none"
        />
        <button className="btn bg-white text-ink-950 hover:bg-ink-200" disabled={asking}>
          {asking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Ask
        </button>
      </form>
      {answer && (
        <pre className="whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 font-sans text-sm text-ink-200">
          {answer.answer}
        </pre>
      )}

      <div className="max-h-[340px] space-y-0.5 overflow-y-auto pr-1">
        {data.events.length === 0 && <p className="text-sm text-ink-500">No memory changes yet.</p>}
        {data.events.map((e) => <EventRow key={e.event_id} e={e} />)}
      </div>
    </div>
  );
}
