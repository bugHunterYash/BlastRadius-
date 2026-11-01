"use client"

import { useCallback, useContext, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { api, type FolderListing } from "@/lib/api"
import { folderName } from "./project-workspace"
import { RuntimeMark } from "./runtime-logo"
import { useTower } from "./tower-store"
import { UserContext } from "./user-menu"

/** The folders list, refreshed while `on`. */
export function useFolders(on: boolean) {
  const [data, setData] = useState<FolderListing | null>(null)
  const refresh = useCallback(() => api.folders().then(setData, () => {}), [])
  useEffect(() => {
    if (!on) return
    refresh()
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [on, refresh])
  return { data, refresh }
}

/** Which folders the tower may show chats from. Nothing from the Claude, Codex or Antigravity apps appears
 *  until its folder is allowed here; removing a folder takes its chats out of the tower again. */
export function FolderAccess() {
  const { state, setFoldersOpen } = useTower()
  const user = useContext(UserContext)
  const { data, refresh } = useFolders(state.foldersOpen)
  const [custom, setCustom] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const allow = async (path: string) => {
    setBusy(path)
    try {
      const f = await api.allowFolder(path, user?.email)
      toast.success(`${f.name} allowed`, { description: "Chats from your apps in this folder now show up here." })
      setCustom("")
    } catch (e) {
      toast.error("Couldn’t allow the folder", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
      refresh()
    }
  }
  const remove = async (path: string) => {
    setBusy(path)
    try {
      const r = await api.removeFolder(path)
      toast.success(`${folderName(path)} removed`, { description: `${r.removed} synced ${r.removed === 1 ? "chat" : "chats"} taken out of the tower. They stay in their apps.` })
    } catch (e) {
      toast.error("Couldn’t remove the folder", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
      refresh()
    }
  }

  return (
    <Dialog open={state.foldersOpen} onOpenChange={setFoldersOpen}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Folders the tower can see</DialogTitle>
          <DialogDescription>
            Your Claude, Codex and Antigravity chats show up here only for the folders you allow. Nothing else is read.
          </DialogDescription>
        </DialogHeader>

        {data && !data.enforced && (
          <p className="rounded-lg bg-flag-soft px-3 py-2 text-[13px] text-flag">
            This server syncs every folder (LIVE_SYNC_ALLOWED_FOLDERS_ONLY is off), so this list isn’t used.
          </p>
        )}

        <section className="grid gap-2">
          <h3 className="text-[13.5px] font-semibold">Allowed</h3>
          {!data ? (
            <p className="text-[13.5px] text-muted-foreground">Loading…</p>
          ) : data.allowed.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-3 text-[13.5px] text-muted-foreground">No folders yet. Allow one below to see its chats.</p>
          ) : (
            data.allowed.map((f) => (
              <div key={f.path} className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
                <Icon name="folder_open" size={19} className="text-cobalt" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{f.name}</div>
                  <div className="truncate font-mono text-[11.5px] text-muted-foreground" title={f.path}>{f.path}</div>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy === f.path} onClick={() => remove(f.path)}>
                  Remove
                </Button>
              </div>
            ))
          )}
        </section>

        {data && data.suggested.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-[13.5px] font-semibold">Your apps work in these folders</h3>
            {data.suggested.map((f) => (
              <div key={f.path} className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
                <span className="flex shrink-0 -space-x-1">
                  {f.apps.filter((a) => ["claude", "codex", "antigravity"].includes(a)).map((a) => (
                    <RuntimeMark key={a} provider={a} className="size-[18px] rounded-full ring-2 ring-card" />
                  ))}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{folderName(f.path)}</div>
                  <div className="truncate font-mono text-[11.5px] text-muted-foreground" title={f.path}>{f.path}</div>
                </div>
                <Button size="sm" className="bg-cobalt text-white hover:bg-cobalt/90" disabled={busy === f.path} onClick={() => allow(f.path)}>
                  Allow
                </Button>
              </div>
            ))}
          </section>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (custom.trim()) void allow(custom.trim())
          }}
        >
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or type a folder path, e.g. C:\Users\you\Documents\project" className="font-mono text-[13px]" />
          <Button type="submit" variant="outline" disabled={!custom.trim() || busy !== null}>Allow</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
