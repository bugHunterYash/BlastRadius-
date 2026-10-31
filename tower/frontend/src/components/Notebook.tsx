import { BookOpen, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, hhmmss, type AuditRow, type NotebookItem } from "../api";

/** The shared notebook every agent reads and writes, newest first. */
export function Notebook({ tick, mode }: { tick: number; mode: string }) {
  const [items, setItems] = useState<NotebookItem[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => api.notebook(q || undefined).then(setItems).catch(() => undefined), 200);
    return () => clearTimeout(t);
  }, [q, tick]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-ink-400">
          <BookOpen size={13} />
          {mode === "meko" ? "Meko Datapack" : "Local notebook (stand-in until Meko access)"}
        </p>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="search, e.g. fact:price"
          className="w-56 rounded-lg border border-white/10 bg-ink-850 px-3 py-1.5 text-sm text-white placeholder:text-ink-500 focus:outline-none"
        />
      </div>
      <div className="mt-3 max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
        {items.length === 0 && <p className="text-sm text-ink-500">Nothing here yet.</p>}
        {items.map((it, i) => (
          <div key={it.item_id ?? i} className={`rounded-lg border px-3 py-2 text-sm ${it.kind === "approval" ? "border-ok/25 bg-ok/[0.05]" : "border-white/[0.06] bg-white/[0.02]"}`}>
            <div className="flex items-center gap-2 text-[11px] text-ink-500">
              {it.kind === "approval" && <ShieldCheck size={12} className="text-ok" />}
              <span>{it.kind}</span>
              <span>{hhmmss(it.created_at)}</span>
            </div>
            <div className="mt-0.5 break-words font-mono text-xs text-ink-200">{it.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Audit({ tick }: { tick: number }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    api.audit().then(setRows).catch(() => undefined);
  }, [tick]);

  if (!rows.length) return <p className="text-sm text-ink-500">No decisions yet. Approvals land here and in the notebook.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-ink-500">
          <tr>
            <th className="py-2 pr-3 font-medium">When</th>
            <th className="pr-3 font-medium">Decision</th>
            <th className="pr-3 font-medium">Issue</th>
            <th className="pr-3 font-medium">Change</th>
            <th className="font-medium">Notebook</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.approval_id} className="border-t border-white/[0.05] align-top">
              <td className="py-2 pr-3 font-mono text-xs text-ink-400">{hhmmss(r.decided_at)}</td>
              <td className={`pr-3 ${r.decision === "approved" ? "text-ok" : "text-ink-400"}`}>
                {r.decision} <span className="text-ink-500">by {r.decided_by}</span>
              </td>
              <td className="pr-3 text-ink-200">{r.type.replace("_", " ")} · {r.agent}</td>
              <td className="pr-3 font-mono text-xs text-ink-300">{r.fix_type} on {r.patch.target_agent}: {r.patch.after}</td>
              <td className="font-mono text-xs text-ink-500">{r.meko_ref?.slice(0, 16) ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
