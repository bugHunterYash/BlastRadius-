// Typed client for the control tower backend (/v1, proxied by Vite).

export type Op = "run_start" | "run_end" | "read" | "write" | "handoff";
export type IssueType = "stale_read" | "conflict" | "skipped_handoff" | "permission_leak";
export type IssueStatus = "open" | "fix_ready" | "approved" | "rejected" | "resolved";

export interface Health { db: boolean; notebook: string; summarizer: string; fixer: string }

export interface Run {
  run_id: string; datapack: string; scenario: string | null; status: string;
  started_at: string; ended_at: string | null; issues: number; open_issues: number; events: number;
}

export interface Event {
  event_id: string; run_id: string; agent: string; op: Op; fact_key: string | null; version: number | null;
  value_preview: string | null; target_agent: string | null; reason: string | null; ts: string;
}

export interface Fix {
  fix_id: string; explanation: string; fix_type: string; model: string; target_agent: string;
  before: string; after: string; risk: "low" | "medium" | "high"; verify_by: string;
}

export interface Issue {
  issue_id: string; run_id: string; type: IssueType; agent: string; fact_key: string | null;
  evidence: string[]; detail: string | null; note: string | null; status: IssueStatus; created_at: string;
  fix: Fix | null;
}

export interface IssueDetail extends Omit<Issue, "evidence"> {
  evidence: Event[];
  approval: { decision: string; decided_by: string; decided_at: string; meko_ref: string | null } | null;
}

export interface Design {
  agents: string[]; handoffs: [string, string][]; must_pass_through: Record<string, string[]>;
  permissions: Record<string, { read?: string[]; write?: string[] }>;
}

export interface Digest {
  digest_id: string; run_id: string; model: string; created_at: string;
  summary: { headline: string; by_agent: { agent: string; summary: string }[]; notable: string[] };
}

export interface NotebookItem { item_id: string | null; kind: string; text: string; created_at: string | null }

export interface AuditRow {
  approval_id: string; decision: string; decided_by: string; note: string | null; meko_ref: string | null;
  decided_at: string; fix_type: string; patch: Record<string, string>; type: IssueType; agent: string;
  fact_key: string | null; run_id: string; model: string;
}

export interface Blast {
  root: string; run_id: string;
  nodes: { id: string; agent: string; op: Op; fact_key: string; version: number; ts: string; hop: number }[];
  edges: { from: string; to: string }[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = (await r.json()).detail ?? detail; } catch { /* not JSON */ }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return r.json() as Promise<T>;
}

const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : "";
};

export const api = {
  health: () => req<Health>("/v1/health"),
  runs: () => req<Run[]>("/v1/runs?limit=30"),
  runEvents: (id: string) => req<Event[]>(`/v1/runs/${encodeURIComponent(id)}/events`),
  issues: (run_id?: string) => req<Issue[]>(`/v1/issues${qs({ run_id })}`),
  issue: (id: string) => req<IssueDetail>(`/v1/issues/${id}`),
  design: () => req<Design>("/v1/design"),
  timeline: (run_id?: string) => req<{ events: Event[]; digests: Digest[] }>(`/v1/timeline${qs({ run_id })}`),
  ask: (question: string, agent?: string) =>
    req<{ answer: string; cited_times: string[]; model: string; rows: number }>("/v1/timeline/ask", {
      method: "POST", body: JSON.stringify({ question, agent: agent || undefined }),
    }),
  notebook: (q?: string) => req<NotebookItem[]>(`/v1/notebook${qs({ q, limit: "100" })}`),
  audit: () => req<AuditRow[]>("/v1/audit"),
  blast: (event_id: string) => req<Blast>(`/v1/blast-radius${qs({ event_id })}`),
  decide: (fix_id: string, decision: "approve" | "reject", decided_by: string, note?: string) =>
    req(`/v1/fixes/${fix_id}/${decision}`, { method: "POST", body: JSON.stringify({ decided_by, note }) }),
};

export const ISSUE_LABEL: Record<IssueType, string> = {
  stale_read: "Stale read",
  conflict: "Conflicting write",
  skipped_handoff: "Skipped handoff",
  permission_leak: "Permission leak",
};

export const hhmmss = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : "");
