// With Google sign-in set up, the dashboard and the agent API need a signed-in, allowed account:
// a page sends you to /login (and back after), the API answers 401. Without it, nothing changes.

import { NextResponse } from "next/server"
import { auth, authEnabled } from "@/auth"

const guarded = auth((req) => {
  if (req.auth?.user) return NextResponse.next()
  if (req.nextUrl.pathname.startsWith("/api/")) return Response.json({ detail: "sign in first" }, { status: 401 })
  const login = new URL("/login", req.nextUrl.origin)
  login.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.redirect(login)
})

export default authEnabled ? guarded : () => NextResponse.next()

export const config = { matcher: ["/dashboard/:path*", "/api/tower/:path*"] }
