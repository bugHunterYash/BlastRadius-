import { Activity, AlertTriangle, CheckCircle2, Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type Design, type Event, type Health, type Issue, type Run } from "./api";
import { BlastX } from "./components/BlastX";
import { DesignGraph } from "./components/DesignGraph";
import { IssueCard } from "./components/IssueCard";
import { Audit, Notebook } from "./components/Notebook";
import { Timeline } from "./components/Timeline";
import { useStream } from "./useStream";

const TABS = ["Timeline", "Notebook", "BlastX", "Audit"] as const;
type Tab = (typeof TABS)[number];

function readName() {
  try { return localStorage.getItem("tower.approver") ?? ""; } catch { return ""; }
}

export function App() {
  const { tick, connected } = useStream();
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState<string>("");
  const [pinned, setPinned] = useState(false);
  const [design, setDesign] = useState<Design | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [tab, setTab] = useState<Tab>("Timeline");
  const [approver, setApprover] = useState(readName);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api.design().then(setDesign).catch(() => undefined);
    api.runs().then((rs) => {
      setRuns(rs);
      // Follow the newest run live unless the user picked one.
      if (!pinned && rs[0]) setRunId(rs[0].run_id);
    }).catch(() => undefined);
  }, [tick, pinned]);

  useEffect(() => {
    if (!runId) return;
    api.runEvents(runId).then(setEvents).catch(() => setEvents([]));
    api.issues(runId).then(setIssues).catch(() => setIssues([]));
  }, [runId, tick]);

  useEffect(() => {
    try { localStorage.setItem("tower.approver", approver); } catch { /* private mode */ }
  }, [approver]);

  const run = runs.find((r) => r.run_id === runId);
  const counts = useMemo(() => ({
    open: issues.filter((i) => i.status === "open" || i.status === "fix_ready").length,
    fixed: issues.filter((i) => i.status === "approved" || i.status === "resolved").length,
  }), [issues]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" className="h-7 w-7" />
            <div>
              <div className="text-[15px] font-semibold leading-tight text-white">Agent Control Tower</div>
              <div className="text-[11px] text-ink-500">shared notebook · {run?.datapack ?? "content-team"}</div>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-ink-300">
            {health && (
              <>
                <span className="chip" title="Where agent memory lives">notebook: {health.notebook}</span>
                <span className="chip" title="Who drafts fixes">fixer: {health.fixer}</span>
                <span className="chip" title="Who writes run digests">summary: {health.summarizer}</span>
              </>
            )}
            <span className={`chip ${connected ? "text-ok" : "text-bad"}`}>
              <Radio size={12} className={connected ? "live-dot" : ""} /> {connected ? "live" : "offline"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {!health && (
          <div className="card mb-6 flex items-center gap-3 p-4 text-sm text-warn">
            <AlertTriangle size={16} /> Can't reach the backend. Start it, then run the demo team.
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="run" className="text-[11px] uppercase tracking-wider text-ink-500">Run</label>
            <select
              id="run" value={runId}
              onChange={(e) => { setRunId(e.target.value); setPinned(e.target.value !== runs[0]?.run_id); }}
              className="mt-1 block w-[260px] max-w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-white"
            >
              {runs.length === 0 && <option value="">no runs yet</option>}
              {runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.run_id} · {r.open_issues ? `${r.open_issues} open` : "clean"}
                </option>
              ))}
            </select>
          </div>
          {run && (
            <div className="flex flex-wrap gap-2 pb-1">
              <span className="chip"><Activity size={12} /> {run.status}</span>
              <span className="chip">{run.events} events</span>
              {run.scenario && <span className="chip">scenario: {run.scenario}</span>}
              <span className={`chip ${counts.open ? "text-bad" : "text-ok"}`}>
                {counts.open ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {counts.open} open · {counts.fixed} fixed
              </span>
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <section className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-white">Design vs reality</h2>
                <div className="flex flex-wrap gap-3 text-[11px] text-ink-400">
                  <span><span className="mr-1 inline-block h-0.5 w-4 bg-ok align-middle" />followed</span>
                  <span><span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-bad align-middle" />skipped</span>
                  <span><span className="mr-1 inline-block h-0.5 w-4 bg-blast align-middle" />off-design</span>
                </div>
              </div>
              {design ? <DesignGraph design={design} events={events} issues={issues} /> : <div className="h-[300px]" />}
            </section>

            <section className="card p-4">
              <div className="mb-4 flex flex-wrap gap-1">
                {TABS.map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)} className={`tab ${tab === t ? "tab-on" : ""}`}>
                    {t}
                  </button>
                ))}
              </div>
              {tab === "Timeline" && <Timeline runId={runId || undefined} tick={tick} />}
              {tab === "Notebook" && <Notebook tick={tick} mode={health?.notebook ?? "local"} />}
              {tab === "BlastX" && <BlastX events={events} />}
              {tab === "Audit" && <Audit tick={tick} />}
            </section>
          </div>

          <aside className="space-y-3 lg:col-span-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-white">Issues</h2>
              <label className="flex items-center gap-2 text-xs text-ink-400">
                approving as
                <input
                  value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="your name"
                  className="w-28 rounded-md border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white focus:outline-none"
                />
              </label>
            </div>
            {issues.length === 0 && (
              <div className="card p-6 text-center text-sm text-ink-400">
                {run?.status === "analysing" ? "Analysing this run…" : "No coordination issues in this run."}
              </div>
            )}
            {issues.map((i) => <IssueCard key={i.issue_id} issue={i} tick={tick} approver={approver} />)}
          </aside>
        </div>
      </main>
    </div>
  );
}
