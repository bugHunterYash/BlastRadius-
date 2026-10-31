// Browser-side client. Everything goes through /api/tower (a Next.js route that adds the backend
// token on the server), so no secret ever reaches the browser.

import type { ApiAgentRoute, ApiDigest, ApiEvent, ApiExecEvent, ApiInvocation, ApiIssue, ApiRun, Snapshot } from "./data"

/** Execution events worth a line in the timeline (streamed text deltas and raw output chunks are folded away). */
const STEP_TYPES = [
  "prompt.received", "session.started", "message.completed", "tool.started", "tool.completed", "command.started",
  "command.completed", "file.changed", "approval.requested", "execution.error", "invocation.completed",
  "invocation.failed", "invocation.cancelled",
].join(",")
import type { DesignSpec } from "./types"

const BASE = "/api/tower"

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" })
  if (!r.ok) {
    let detail = r.statusText
    try {
      const body = await r.json()
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body)
    } catch {
      /* not JSON */
    }
    throw new Error(detail || `HTTP ${r.status}`)
  }
  return r.json() as Promise<T>
}

export interface LoginState {
  provider: "claude" | "codex"
  status: "pending" | "succeeded" | "failed" | "cancelled"
  url: string | null
  message: string
}

export interface ProviderAuth {
  provider: "claude" | "codex"
  logged_in: boolean
  auth_method: string | null
  subscription?: string | null
  detail?: string
  login: LoginState | null
}

export interface Invocation {
  invocation_id: string
  run_id: string
  agent_id: string
  provider: string
  runtime: string
  model: string | null
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout"
  user_prompt: string
  final_response: string | null
  error_message: string | null
  running: boolean
}

export interface ExecEvent {
  run_id: string
  agent_id: string
  invocation_id: string
  sequence: number
  event_type: string
  why: string | null
  payload: Record<string, unknown>
  timestamp: string
}

export const api = {
  runs: () => req<ApiRun[]>("/v1/runs?limit=30"),
  events: (runId: string) => req<ApiEvent[]>(`/v1/runs/${encodeURIComponent(runId)}/events`),
  issues: (runId: string) => req<ApiIssue[]>(`/v1/issues?run_id=${encodeURIComponent(runId)}`),
  design: () => req<DesignSpec>("/v1/design"),
  digests: (runId: string) => req<{ digests: ApiDigest[] }>(`/v1/timeline?run_id=${encodeURIComponent(runId)}`),
  agents: () => req<ApiAgentRoute[]>("/v1/agents"),
  runInvocations: (runId: string, full = false) =>
    req<{ invocations: ApiInvocation[] }>(`/v1/runs/${encodeURIComponent(runId)}/invocations${full ? "?full=true" : ""}`),
  steps: (invocationId: string) => req<ApiExecEvent[]>(`/v1/invocations/${invocationId}/events?types=${STEP_TYPES}&limit=2000`),
  decide: (fixId: string, decision: "approve" | "reject", decidedBy: string) =>
    req(`/v1/fixes/${fixId}/${decision}`, { method: "POST", body: JSON.stringify({ decided_by: decidedBy }) }),
  note: (text: string) => req<{ ref: string }>("/v1/notebook", { method: "POST", body: JSON.stringify({ text, kind: "memory" }) }),
  auth: () => req<{ claude: ProviderAuth; codex: ProviderAuth }>("/v1/agents/auth"),
  login: (provider: "claude" | "codex") => req<LoginState>(`/v1/agents/auth/${provider}/login`, { method: "POST" }),
  cancelLogin: (provider: "claude" | "codex") => req(`/v1/agents/auth/${provider}/cancel`, { method: "POST" }),
  loginCode: (code: string) => req("/v1/agents/auth/claude/code", { method: "POST", body: JSON.stringify({ code }) }),
  /** sessionId continues an earlier conversation with this agent (Claude session / Codex thread). */
  invoke: (agent: string, runId: string, prompt: string, why?: string, sessionId?: string | null) =>
    req<Invocation & { created: boolean }>(`/v1/agents/${encodeURIComponent(agent)}/invoke`, {
      method: "POST",
      body: JSON.stringify({ run_id: runId, prompt, why: why ?? "Asked from the Control Tower chat", session_id: sessionId ?? null }),
    }),
  invocation: (id: string) => req<Invocation>(`/v1/invocations/${id}`),
  cancel: (id: string) => req(`/v1/invocations/${id}/cancel`, { method: "POST" }),
}

/** Questions asked from the chat go to their own run per day, so they don't mix with a scenario's run. */
export const chatRun = () => `chat-${new Date().toISOString().slice(0, 10)}`

/** The newest run (or the one asked for), with everything the views need. */
export async function loadSnapshot(runId?: string): Promise<Snapshot | null> {
  const all = await api.runs()
  // the graph is about shared memory: skip runs without memory events (chat questions, imported sessions)
  const runs = all.filter((r) => r.events > 0 && !r.run_id.startsWith("chat-") && !r.run_id.startsWith("claude-session-"))
  const id = runId && all.some((r) => r.run_id === runId) ? runId : (runs[0] ?? all[0])?.run_id
  if (!id) return null
  const [events, issues, design, timeline, agents, inv, chat] = await Promise.all([
    api.events(id), api.issues(id), api.design(), api.digests(id), api.agents().catch(() => [] as ApiAgentRoute[]),
    api.runInvocations(id).catch(() => ({ invocations: [] as ApiInvocation[] })),
    // today's conversation with the agents, from the database, so it survives a reload
    api.runInvocations(chatRun(), true).catch(() => ({ invocations: [] as ApiInvocation[] })),
  ])
  const execEvents = (await Promise.all(inv.invocations.map((i) => api.steps(i.invocation_id).catch(() => [] as ApiExecEvent[])))).flat()
  return { runId: id, runs: all, events, issues, design, digests: timeline.digests, agents, invocations: inv.invocations, execEvents,
           chatInvocations: chat.invocations }
}

// token-by-token deltas and raw command output are left out: answers arrive per completed message,
// which keeps the stream light (a stalled tab can't pile up thousands of chunks in the proxy)
export const STREAM_URL = `${BASE}/v1/stream?exclude=agent.message.delta,agent.command.output`
