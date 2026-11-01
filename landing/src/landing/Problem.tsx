import { FileQuestion, Gauge, UserX } from "lucide-react";
import { Reveal, SectionHead } from "../components/Reveal";
import { Spotlight } from "../components/Spotlight";

const PROBLEMS = [
  {
    icon: FileQuestion,
    title: "Your architecture diagram is a guess",
    body: "It says the API depends on Redis. Nobody has checked what actually happens when Redis dies at 2 a.m. You find out from angry customers.",
  },
  {
    icon: Gauge,
    title: "Your load test is too polite",
    body: "Most load tests wait for the server before sending the next request, so a slow app gets less traffic and looks healthier than it is. Real users don't wait.",
  },
  {
    icon: UserX,
    title: "There's no SRE on your team",
    body: "Big companies pay reliability engineers to break things on purpose. Startups and student teams ship without one and hope. Hope is not a plan.",
  },
];

export function Problem() {
  return (
    <section className="mx-auto mt-40 max-w-page px-5">
      <SectionHead
        eyebrow="The problem"
        title={
          <>
            <span className="chrome-text">Every outage is a test</span>
            <br />
            <span className="chrome-text-soft">you didn't run.</span>
          </>
        }
        sub="Outages rarely come from code you were worried about. They come from a dependency you forgot, under traffic you never tried."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {PROBLEMS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.1}>
            <Spotlight className="h-full p-7">
              <div className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                <p.icon size={20} className="text-ink-200" />
              </div>
              <h3 className="mt-6 text-xl font-semibold tracking-tight text-white">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-ink-300">{p.body}</p>
            </Spotlight>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
