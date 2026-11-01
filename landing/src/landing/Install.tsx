import { CopyCommand } from "../components/CopyCommand";
import { Reveal, SectionHead } from "../components/Reveal";

const STEPS = [
  {
    cmd: "npm install -g blastx",
    title: "Install",
    body: "Only Docker is required. The engine, traffic generator and database ship inside one image, so there's no Python or k6 to set up.",
  },
  {
    cmd: "blastx init",
    title: "Point it at your app",
    body: "It finds your docker-compose.yml and asks two questions: which pages matter, and what's safe to break. Your compose file is never edited.",
  },
  {
    cmd: "blastx scan",
    title: "Get your score",
    body: "The AI runs the tests, explains what failed in plain words, and offers fixes. Open localhost:7777 to watch it live.",
  },
];

export function Install() {
  return (
    <section id="install" className="mx-auto mt-40 max-w-page scroll-mt-28 px-5">
      <SectionHead
        eyebrow="Get started"
        title={
          <>
            <span className="chrome-text">Three commands.</span>{" "}
            <span className="chrome-text-soft">Five minutes.</span>
          </>
        }
      />
      <div className="relative mt-14 grid gap-5 md:grid-cols-3">
        <div aria-hidden="true" className="absolute left-0 right-0 top-[38px] hidden h-px bg-gradient-to-r from-transparent via-white/15 to-transparent md:block" />
        {STEPS.map((s, i) => (
          <Reveal key={s.cmd} delay={i * 0.12} className="relative">
            <div className="grid h-[76px] w-[76px] place-items-center rounded-2xl chrome-border text-2xl font-semibold">
              <span className="chrome-text">{i + 1}</span>
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-tight text-white">{s.title}</h3>
            <p className="mt-2 leading-relaxed text-ink-300">{s.body}</p>
            <CopyCommand command={s.cmd} className="mt-5" />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
