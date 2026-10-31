const STACK = [
  "Docker Compose",
  "Redis",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Node.js",
  "Python",
  "Go",
  "Nginx",
  "RabbitMQ",
  "GitHub Actions",
  "k6",
];

export function StackMarquee() {
  return (
    <section className="mx-auto mt-24 max-w-page px-5" aria-label="Works with your stack">
      <p className="text-center text-sm text-ink-400">Works with the services you already run</p>
      <div className="edge-fade mt-6 overflow-hidden">
        <div className="animate-marquee flex w-max gap-14">
          {[...STACK, ...STACK].map((s, i) => (
            <span
              key={s + i}
              aria-hidden={i >= STACK.length}
              className="whitespace-nowrap text-xl font-semibold tracking-tight text-ink-500 transition hover:text-ink-200"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
