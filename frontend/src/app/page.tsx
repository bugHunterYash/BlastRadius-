import { redirect } from "next/navigation"

// The landing page goes here; until then the root opens the dashboard (which asks for sign-in if it's set up).
export default function Home() {
  redirect("/dashboard")
}
