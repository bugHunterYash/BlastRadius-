import { useState } from "react";
import { ScrollProgress } from "./components/ScrollProgress";
import { ScrollStatement } from "./landing/ScrollStatement";
import { Stats } from "./landing/Stats";
import { Bento } from "./landing/Bento";
import { Beginner } from "./landing/Beginner";
import { Faq } from "./landing/Faq";
import { FinalCta, Footer } from "./landing/Footer";
import { Hero } from "./landing/Hero";
import { Install } from "./landing/Install";
import { Loop } from "./landing/Loop";
import { Navbar } from "./landing/Navbar";
import { Pricing } from "./landing/Pricing";
import { Problem } from "./landing/Problem";
import { StackMarquee } from "./landing/StackMarquee";
import { Surfaces } from "./landing/Surfaces";
import { UseCases } from "./landing/UseCases";
import { Waitlist } from "./landing/Waitlist";
import type { Plan } from "./lib/api";

export default function App() {
  const [plan, setPlan] = useState<Plan>("pro");

  // Free goes to the install steps; paid tiers pre-select the waitlist plan.
  const choose = (p: Plan) => {
    if (p === "free") {
      document.getElementById("install")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setPlan(p);
    document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="overflow-x-clip">
      <ScrollProgress />
      <Navbar />
      <main>
        <Hero />
        <StackMarquee />
        <Stats />
        <Problem />
        <ScrollStatement />
        <Loop />
        <Bento />
        <Beginner />
        <UseCases />
        <Surfaces />
        <Install />
        <Pricing onChoose={choose} />
        <Waitlist plan={plan} setPlan={setPlan} />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
