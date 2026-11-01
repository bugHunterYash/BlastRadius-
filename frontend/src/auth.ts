// Google sign-in (Auth.js). The dashboard drives agents on this machine, so only the Google accounts listed in
// AUTH_ALLOWED_EMAILS may sign in. Environment (server only, see .env.example):
//   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET  the OAuth client from Google Cloud Console
//   AUTH_SECRET                         signs the session cookie (any long random string)
//   AUTH_ALLOWED_EMAILS                 comma list of Google accounts that may use the dashboard
// Without AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET sign-in is off and the dashboard stays local-only, as before.

import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

export const authEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)

const allowed = new Set(
  (process.env.AUTH_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
)

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    // a verified Google address that is on the list; anyone else gets "AccessDenied" on the login page
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase()
      return Boolean(email && profile?.email_verified && allowed.has(email))
    },
    // used by the middleware: no session, no dashboard
    authorized({ auth }) {
      return Boolean(auth?.user)
    },
  },
})
