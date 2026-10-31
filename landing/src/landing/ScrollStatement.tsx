import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useRef } from "react";

// Words light up one by one as the section scrolls through the screen.
const TEXT =
  "Most teams find out how their app breaks from their customers. BlastRadius finds out first: it breaks your app on purpose, proves what failed, fixes it, and shows you the receipts.";
const HIGHLIGHT = new Set(["customers.", "first:", "proves", "fixes", "receipts."]);

function Word({ word, progress, range }: { word: string; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.14, 1]);
  const y = useTransform(progress, range, [8, 0]);
  const hot = HIGHLIGHT.has(word);
  return (
    <motion.span style={{ opacity, y }} className={`mr-[0.25em] inline-block ${hot ? "blast-text" : "text-white"}`}>
      {word}
    </motion.span>
  );
}

export function ScrollStatement() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 45%"] });
  const words = TEXT.split(" ");
  return (
    <section ref={ref} className="relative mx-auto mt-40 max-w-5xl px-5">
      <div aria-hidden="true" className="aurora-slow absolute left-1/4 top-0 h-72 w-72 rounded-full bg-blast/20 blur-[110px]" />
      <p className="relative text-3xl font-semibold leading-[1.25] tracking-tight md:text-5xl" aria-label={TEXT}>
        {words.map((w, i) => (
          <Word key={i} word={w} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} />
        ))}
      </p>
    </section>
  );
}
