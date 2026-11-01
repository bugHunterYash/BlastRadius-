// With Google sign-in set up, the dashboard and the agent API need a signed-in, allowed account:
// a page sends you to /login (and back after), the API answers 401. When sign-in is required but not set up
// (a production server without Google keys), nothing opens. In dev without keys, nothing changes.

import { NextResponse, type NextRequest } from "next/server"
import { auth, authEnabled, authRequired } from "@/auth"

const guarded = auth((req) => {
  if (req.auth?.user) return NextResponse.next()
  if (req.nextUrl.pathname.startsWith("/api/")) return Response.json({ detail: "sign in first" }, { status: 401 })
  const login = new URL("/login", req.nextUrl.origin)
  login.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.redirect(login)
})

// sign-in required but not set up: nothing opens until it is
const locked = (req: NextRequest) =>
  req.nextUrl.pathname.startsWith("/api/")
    ? Response.json({ detail: "sign-in isn't set up on this server" }, { status: 401 })
    : NextResponse.redirect(new URL("/login", req.nextUrl.origin))

export default authEnabled ? guarded : authRequired ? locked : () => NextResponse.next()

export const config = { matcher: ["/dashboard/:path*", "/api/tower/:path*"] }
