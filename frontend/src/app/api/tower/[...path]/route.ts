// Server-side proxy to the Control Tower backend. It adds the API token here, on the server, so the
// browser never holds it, and it streams responses through untouched (that's what keeps SSE live).
//   TOWER_API_URL    backend base URL (default http://127.0.0.1:8000)
//   TOWER_API_TOKEN  bearer token for invoke / cancel / auth / notebook writes

import type { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const BACKEND = process.env.TOWER_API_URL ?? "http://127.0.0.1:8000"
const TOKEN = process.env.TOWER_API_TOKEN ?? process.env.TOWER_INGEST_TOKEN ?? "dev-ingest-token-change-me"

async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
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
