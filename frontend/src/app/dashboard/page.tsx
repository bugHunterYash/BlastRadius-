import { auth, authEnabled } from "@/auth"
import { ControlTower } from "@/components/tower/control-tower"

export const dynamic = "force-dynamic"

export default async function Dashboard() {
  const session = authEnabled ? await auth() : null
  const u = session?.user
  return <ControlTower user={u ? { name: u.name ?? null, email: u.email ?? null, image: u.image ?? null } : null} />
}
