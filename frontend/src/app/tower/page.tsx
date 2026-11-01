import { redirect } from "next/navigation"

// the dashboard moved to /dashboard; old links keep working
export default function TowerPage() {
  redirect("/dashboard")
}
