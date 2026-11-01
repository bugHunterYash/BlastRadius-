import { motion, useScroll, useSpring } from "framer-motion";

// Thin glowing bar at the top that fills as the page scrolls.
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX, transformOrigin: "0% 50%" }}
      className="fixed inset-x-0 top-0 z-[60] h-[3px] bg-gradient-to-r from-[#ffb38a] via-blast to-[#ff3d6e] shadow-[0_0_16px_rgba(255,106,61,0.8)]"
    />
  );
}
