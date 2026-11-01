"use client"

import { createContext, useContext } from "react"
import { signOutAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"

export type SignedInUser = { name: string | null; email: string | null; image: string | null }

/** The Google account signed in to the dashboard, or null when sign-in isn't set up. */
export const UserContext = createContext<SignedInUser | null>(null)

/** Who is signed in, and a way out. Shows nothing when sign-in is off. */
export function UserMenu() {
  const user = useContext(UserContext)
  if (!user) return null
  const label = user.name || user.email?.split("@")[0] || "Signed in"
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="flex items-center gap-2 rounded-lg px-1.5" title={user.email ?? undefined}>
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full object-cover ring-1 ring-border" />
        ) : (
          <span className="grid size-7 place-items-center rounded-full bg-muted text-[13px] font-bold">{label[0]?.toUpperCase()}</span>
        )}
        <span className="hidden max-w-[120px] truncate text-[13.5px] font-semibold 2xl:inline">{label}</span>
      </span>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Sign out" title="Sign out">
          <Icon name="logout" size={18} />
        </Button>
      </form>
    </div>
  )
}
