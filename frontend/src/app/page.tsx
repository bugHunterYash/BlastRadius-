import { LandingPage } from "@/components/landing/landing-page"

export const metadata = {
  title: "BlastRadius | Break it before production does",
  description: "An AI reliability agent for Docker Compose apps. Maps your services, injects faults under real synthetic traffic in an isolated sandbox, delivers evidence-backed AI fixes, and proves them with before/after re-runs.",
}

export default function Home() {
  return <LandingPage />
}
