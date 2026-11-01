"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, ExternalLink, KeyRound, Loader2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { api, type ProviderAuth } from "@/lib/api"
import { cap } from "@/lib/format"
import { DESIGN, PROVIDERS } from "@/lib/data"
import { useTower } from "./tower-store"

type Provider = "claude" | "codex" | "antigravity"
type AuthMap = Partial<Record<Provider, ProviderAuth>>

const INFO: Record<Provider, { name: string; how: string; account: string }> = {
  claude: {
    name: "Claude Code",
    how: "Opens Anthropic’s sign-in page. Choose “Continue with Google” (or email) to use your Claude subscription.",
    account: "Claude account",
  },
  codex: {
    name: "Codex",
    how: "Opens ChatGPT’s sign-in page for the Codex CLI on this machine.",
    account: "ChatGPT account",
  },
  antigravity: {
    name: "Antigravity",
    how: "Signs in with Google inside the Antigravity app. Open Antigravity, sign in there, and the tower picks it up.",
    account: "Google account",
  },
}

// One shared copy, so the composer and the dialog agree without fetching twice.
let cache: AuthMap = {}
const listeners = new Set<(a: AuthMap) => void>()
const publish = (a: AuthMap) => {
  cache = a
  listeners.forEach((l) => l(a))
}

/** Sign-in state of each runtime. Polls fast while a sign-in is in progress. */
export function useAgentAuth(poll = false) {
  const [auth, setAuth] = useState<AuthMap>(cache)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      const a = await api.auth()
      publish({ claude: a.claude, codex: a.codex, antigravity: a.antigravity })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    listeners.add(setAuth)
    if (!cache.claude) void refresh()
    return () => void listeners.delete(setAuth)
  }, [refresh])
  const pending = Object.values(auth).some((a) => a?.login?.status === "pending")
  useEffect(() => {
    if (!pending || !poll) return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [pending, poll, refresh])
  return { auth, error, refresh }
}

export function AgentAccess() {
  const { state, setAccessOpen } = useTower()
  const { auth, error, refresh } = useAgentAuth(state.accessOpen)
  useEffect(() => {
    if (state.accessOpen) void refresh()
  }, [state.accessOpen, refresh])

  return (
    <Dialog open={state.accessOpen} onOpenChange={setAccessOpen}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Connect your agents</DialogTitle>
          <DialogDescription>
            Each runtime signs in with its own provider. You sign in on the provider’s page; the tower never sees your password.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">Backend not reachable: {error}</p>}
        <div className="flex flex-col gap-3">
          {(["claude", "codex", "antigravity"] as Provider[]).map((p) => (
            <ProviderCard key={p} provider={p} auth={auth[p]} onChange={refresh} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProviderCard({ provider, auth, onChange }: { provider: Provider; auth?: ProviderAuth; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState("")
  const login = auth?.login
  const pending = login?.status === "pending"
  const agents = DESIGN.agents.filter((a) => PROVIDERS[a] === provider)
  const [lastStatus, setLastStatus] = useState<string | undefined>(undefined)

  // tell the person when a sign-in finishes
  useEffect(() => {
    const s = login?.status
    if (s && s !== lastStatus) {
      if (lastStatus === "pending" && s === "succeeded") toast.success(`${INFO[provider].name} connected`)
      if (lastStatus === "pending" && s === "failed") toast.error(`${INFO[provider].name} sign-in failed`, { description: login?.message })
      setLastStatus(s)
    }
  }, [login?.status, login?.message, lastStatus, setLastStatus, provider])

  const start = async () => {
    setBusy(true)
    try {
      const l = await api.login(provider as "claude" | "codex")
      if (l.url) window.open(l.url, "_blank", "noopener,noreferrer")
      onChange()
    } catch (e) {
      toast.error(`Couldn’t start ${INFO[provider].name} sign-in`, { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", auth?.logged_in ? "bg-mint/15 text-mint" : "bg-muted text-muted-foreground")}>
          {auth?.logged_in ? <CheckCircle2 className="size-4" /> : <KeyRound className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-medium">{INFO[provider].name}</span>
            <span className="text-xs text-muted-foreground">
              {!auth ? "checking…" : auth.logged_in ? `Connected · ${auth.auth_method}${auth.subscription ? ` · ${auth.subscription}` : ""}` : "Not connected"}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-ink-2">{INFO[provider].how}</p>
          {agents.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">Used by {agents.map(cap).join(", ")}</p>
          )}
          {login && login.status !== "succeeded" && (
            <div className={cn("mt-3 rounded-lg px-3 py-2 text-[13px]", login.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-ink-2")}>
              <div className="flex items-center gap-2">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : login.status === "failed" ? <XCircle className="size-3.5" /> : null}
                {login.message}
              </div>
              {pending && login.url && (
                <a href={login.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-cobalt underline underline-offset-4">
                  Open the sign-in page <ExternalLink className="size-3" />
                </a>
              )}
              {pending && provider === "claude" && (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (!code.trim()) return
                    try {
                      await api.loginCode(code)
                      setCode("")
                    } catch (err) {
                      toast.error("Code not accepted", { description: err instanceof Error ? err.message : String(err) })
                    }
                  }}
                >
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Got a code on the page? Paste it here" className="h-8 text-[13px]" />
                  <Button type="submit" size="sm" variant="secondary" disabled={!code.trim()}>
                    Send
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {provider === "antigravity" ? (
            <Button size="sm" variant="outline" onClick={onChange}>
              Check again
            </Button>
          ) : pending ? (
            <Button size="sm" variant="outline" onClick={() => api.cancelLogin(provider as "claude" | "codex").then(onChange, onChange)}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant={auth?.logged_in ? "outline" : "default"} disabled={busy} onClick={start}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {auth?.logged_in ? "Reconnect" : "Sign in"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
