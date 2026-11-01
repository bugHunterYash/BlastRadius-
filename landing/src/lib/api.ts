// Landing page ↔ FastAPI control plane. In dev, Vite proxies /api to
// 127.0.0.1:8000; VITE_API_URL points somewhere else when set.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export type Plan = "free" | "pro" | "team" | "enterprise";

export interface SiteStats {
  waitlist: number;
  experiments: number;
  reports: number;
}

export interface WaitlistResult {
  status: "joined" | "already_joined";
  position: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: "offline" | "invalid" | "server",
  ) {
    super(message);
  }
}

const OFFLINE = "The BlastRadius engine isn't reachable right now.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(OFFLINE, "offline");
  }
  if (res.status === 422) throw new ApiError("That email doesn't look right.", "invalid");
  // The Vite dev proxy answers with a non-JSON 5xx when the backend is down.
  const isJson = res.headers.get("content-type")?.includes("json") ?? false;
  if (res.status >= 500 && !isJson) throw new ApiError(OFFLINE, "offline");
  if (!res.ok) throw new ApiError(`Something went wrong (${res.status}).`, "server");
  return (await res.json()) as T;
}

export const getStats = () => request<SiteStats>("/api/site/stats");

export const joinWaitlist = (email: string, plan: Plan) =>
  request<WaitlistResult>("/api/site/waitlist", {
    method: "POST",
    body: JSON.stringify({ email, plan }),
  });
