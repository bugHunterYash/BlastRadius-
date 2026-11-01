// Server-side proxy to the Control Tower backend. It adds the API token here, on the server, so the
// browser never holds it, and it streams responses through untouched (that's what keeps SSE live).
//   TOWER_API_URL    backend base URL (default http://127.0.0.1:8000)
//   TOWER_API_TOKEN  bearer token for every backend route
//   TOWER_ALLOWED_HOSTS  host names this UI may be opened under (default: localhost, 127.0.0.1, [::1])
//
// Because this route holds the token, it only answers when the page is opened as one of those hosts
// (so another machine on the network, or a DNS-rebinding page, can't use it), and it only accepts
// changes (POST/PUT) sent as JSON from this same origin (so another website can't trigger them).

import type { NextRequest } from "next/server"
import { auth, authEnabled } from "@/auth"

export const dynamic = "force-dynamic"

const BACKEND = process.env.TOWER_API_URL ?? "http://127.0.0.1:8000"
const TOKEN = process.env.TOWER_API_TOKEN ?? process.env.TOWER_INGEST_TOKEN ?? "dev-ingest-token-change-me"

const ALLOWED_HOSTS = new Set(
  (process.env.TOWER_ALLOWED_HOSTS ?? "localhost,127.0.0.1,[::1]").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
)

/** "localhost:3100" -> "localhost"; "[::1]:3100" -> "[::1]". */
const hostName = (host: string) => (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]).toLowerCase()

function refused(req: NextRequest): string | null {
  const host = req.headers.get("host") ?? ""
  if (!ALLOWED_HOSTS.has(hostName(host))) return "this UI only answers on localhost"
  if (req.method === "GET" || req.method === "HEAD") return null
  const origin = req.headers.get("origin")
  const site = req.headers.get("sec-fetch-site")
  let originHost: string | null = null
  try {
    originHost = origin ? new URL(origin).host : null
  } catch {
    originHost = "invalid"
  }
  if ((origin && originHost !== host) || (site && site !== "same-origin")) return "cross-site requests are not allowed"
  if (!(req.headers.get("content-type") ?? "").includes("application/json") && req.headers.get("content-length") !== "0")
    return "send JSON"
  return null
}

async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const why = refused(req)
  if (why) return Response.json({ detail: why }, { status: 403 })
  // with Google sign-in set up, only a signed-in, allowed account gets through (the middleware checks too)
  if (authEnabled && !(await auth())?.user) return Response.json({ detail: "sign in first" }, { status: 401 })
  const { path } = await params
  // Only the versioned API is reachable through here.
  if (path[0] !== "v1" || path.some((p) => p === ".." || p.includes("\\"))) {
    return Response.json({ detail: "not found" }, { status: 404 })
  }
  const url = `${BACKEND}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`
  const headers = new Headers({ Authorization: `Bearer ${TOKEN}` })
  const type = req.headers.get("content-type")
  if (type) headers.set("Content-Type", type)
  const accept = req.headers.get("accept")
  if (accept) headers.set("Accept", accept)

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
      cache: "no-store",
      signal: req.signal,
    })
  } catch {
    return Response.json({ detail: "Control Tower backend is not reachable" }, { status: 502 })
  }
  const out = new Headers()
  for (const h of ["content-type", "cache-control"]) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  if (out.get("content-type")?.includes("text/event-stream")) out.set("X-Accel-Buffering", "no")
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

export { forward as GET, forward as POST, forward as PUT }
