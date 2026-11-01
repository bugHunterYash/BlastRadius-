import { Radar } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type Blast, type Event } from "../api";
import { EventRow } from "./Timeline";

/** BlastX: pick one write, see every read of that version and everything written because of it. */
export function BlastX({ events }: { events: Event[] }) {
  const writes = useMemo(() => events.filter((e) => e.op === "write"), [events]);
  const [root, setRoot] = useState<string>("");
  const [blast, setBlast] = useState<Blast | null>(null);

  useEffect(() => {
    if (!writes.some((w) => w.event_id === root)) setRoot(writes[0]?.event_id ?? "");
  }, [writes, root]);

  useEffect(() => {
    if (root) api.blast(root).then(setBlast).catch(() => setBlast(null));
    else setBlast(null);
  }, [root]);

  const hops = useMemo(() => {
    const by: Record<number, Blast["nodes"]> = {};
    blast?.nodes.forEach((n) => (by[n.hop] ??= []).push(n));
    return Object.entries(by).map(([h, ns]) => [Number(h), ns] as const).sort((a, b) => a[0] - b[0]);
  }, [blast]);

  if (!writes.length) return <p className="text-sm text-ink-500">This run has no writes to trace.</p>;

  const reach = blast ? blast.nodes.filter((n) => n.op === "write").length - 1 : 0;
  const agents = blast ? new Set(blast.nodes.map((n) => n.agent)).size : 0;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div>
        <p className="mb-2 text-xs text-ink-400">Pick a write to trace</p>
        <div className="max-h-[340px] space-y-0.5 overflow-y-auto pr-1">
          {writes.map((w) => <EventRow key={w.event_id} e={w} active={w.event_id === root} onClick={() => setRoot(w.event_id)} />)}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 text-sm text-white">
          <Radar size={16} className="text-blast" />
          {blast ? <>Reached <b>{agents}</b> agents and <b>{reach}</b> downstream outputs</> : "Tracing…"}
        </div>
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2" key={root}>
          {hops.map(([h, ns]) => (
            <div key={h} className="min-w-[132px] flex-1">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-500">{h === 0 ? "the change" : `hop ${h}`}</div>
              <div className="space-y-2">
                {ns.map((n, i) => (
                  <div
                    key={n.id}
                    className={`ripple-in rounded-lg border px-2.5 py-2 text-xs ${h === 0 ? "border-blast/60 bg-blast/10" : n.op === "write" ? "border-blast/25 bg-white/[0.03]" : "border-accent/25 bg-white/[0.03]"}`}
                    style={{ animationDelay: `${h * 0.35 + i * 0.06}s` }}
                  >
                    <div className="font-semibold capitalize text-white">{n.agent}</div>
                    <div className="mt-0.5 font-mono text-ink-300">
                      {n.op} {n.fact_key} v{n.version}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">
          If this write was wrong, everything to the right of it was built on it.
        </p>
      </div>
    </div>
  );
}
