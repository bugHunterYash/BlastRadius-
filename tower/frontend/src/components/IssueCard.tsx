import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, hhmmss, ISSUE_LABEL, type Issue, type IssueDetail } from "../api";

const STATUS: Record<string, string> = {
  open: "text-warn border-warn/30 bg-warn/10",
  fix_ready: "text-accent border-accent/30 bg-accent/10",
  approved: "text-ok border-ok/30 bg-ok/10",
  resolved: "text-ok border-ok/30 bg-ok/10",
  rejected: "text-ink-400 border-white/10 bg-white/5",
};
const RISK: Record<string, string> = { low: "text-ok", medium: "text-warn", high: "text-bad" };

export function IssueCard({ issue, tick, approver }: { issue: Issue; tick: number; approver: string }) {
  const [open, setOpen] = useState(issue.status === "fix_ready");
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) api.issue(issue.issue_id).then(setDetail).catch(() => setDetail(null));
  }, [open, issue.issue_id, issue.status, tick]);

  const decide = async (d: "approve" | "reject") => {
    if (!issue.fix) return;
    setBusy(d);
    setError("");
    try {
      await api.decide(issue.fix.fix_id, d, approver || "anonymous");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const fix = issue.fix;
  return (
    <article className="card overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 p-4 text-left">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${issue.status === "resolved" || issue.status === "approved" ? "bg-ok" : "bg-bad"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{ISSUE_LABEL[issue.type]}</span>
            <span className="font-mono text-xs text-ink-400">{issue.agent} · {issue.fact_key}</span>
          </div>
          <p className="mt-1 text-sm text-ink-300">{issue.detail}</p>
          {issue.note && <p className="mt-1 text-xs text-warn">{issue.note}</p>}
        </div>
        <span className={`chip shrink-0 ${STATUS[issue.status]}`}>{issue.status.replace("_", " ")}</span>
        <ChevronDown size={16} className={`mt-1 shrink-0 text-ink-500 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-white/[0.06] px-4 pb-4 pt-3">
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">What happened</h4>
            <div className="mt-2 space-y-1 font-mono text-xs">
              {detail?.evidence.map((e) => (
                <div key={e.event_id} className="flex gap-3 rounded-md bg-white/[0.03] px-2 py-1.5">
                  <span className="text-ink-500">{hhmmss(e.ts)}</span>
                  <span className="w-20 text-ink-200">{e.agent}</span>
                  <span className={e.op === "write" ? "text-blast" : e.op === "read" ? "text-accent" : "text-ink-300"}>
                    {e.op.toUpperCase()}
                  </span>
                  <span className="text-ink-200">
                    {e.op === "handoff" ? `→ ${e.target_agent}` : `${e.fact_key} v${e.version}`}
                  </span>
                </div>
              )) ?? <div className="text-ink-500">loading…</div>}
            </div>
          </section>

          {fix ? (
            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Why, and the fix</h4>
              <p className="mt-2 text-sm leading-relaxed text-ink-200">{fix.explanation}</p>
              <div className="mt-3 overflow-hidden rounded-lg border border-white/[0.07] font-mono text-xs">
                <div className="flex items-center justify-between bg-white/[0.03] px-3 py-1.5 text-ink-400">
                  <span>{fix.target_agent}.yaml · {fix.fix_type}</span>
                  <span className={RISK[fix.risk]}>{fix.risk} risk</span>
                </div>
                <div className="whitespace-pre-wrap break-words bg-bad/[0.07] px-3 py-1.5 text-bad">- {fix.before}</div>
                <div className="whitespace-pre-wrap break-words bg-ok/[0.07] px-3 py-1.5 text-ok">+ {fix.after}</div>
              </div>
              <p className="mt-2 text-xs text-ink-400">
                Verify by: {fix.verify_by} · <span className="font-mono">by {fix.model === "template" ? "rule template" : fix.model}</span>
              </p>
              {issue.status === "fix_ready" ? (
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={!!busy} onClick={() => decide("approve")} className="btn bg-white text-ink-950 hover:bg-ink-200">
                    {busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
                  </button>
                  <button type="button" disabled={!!busy} onClick={() => decide("reject")} className="btn border border-white/10 text-ink-200 hover:bg-white/5">
                    {busy === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Reject
                  </button>
                </div>
              ) : detail?.approval ? (
                <p className="mt-3 text-xs text-ink-300">
                  {detail.approval.decision} by <span className="text-white">{detail.approval.decided_by}</span> at{" "}
                  {hhmmss(detail.approval.decided_at)}
                  {detail.approval.meko_ref && <> · written to notebook <span className="font-mono text-ink-500">{detail.approval.meko_ref.slice(0, 18)}</span></>}
                </p>
              ) : null}
              {error && <p className="mt-2 text-xs text-bad">{error}</p>}
            </section>
          ) : (
            <p className="text-xs text-ink-500">The Fixer is still working on this one.</p>
          )}
        </div>
      )}
    </article>
  );
}
