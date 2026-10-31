import { motion } from "framer-motion";
import { useId } from "react";

interface Props {
  size: number;
  className?: string;
  delay?: number;
  spin?: number;
}

// Four-point chrome sparkle from the reference design: a silver gradient body,
// a bright edge highlight and a soft glow, floating slowly.
export function ChromeStar({ size, className = "", delay = 0, spin = 10 }: Props) {
  const id = useId().replace(/:/g, "");
  const path =
    "M50 0 C54 34 66 46 100 50 C66 54 54 66 50 100 C46 66 34 54 0 50 C34 46 46 34 50 0 Z";
  return (
    <motion.svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="-10 -10 120 120"
      className={`pointer-events-none absolute ${className}`}
      initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
      animate={{ opacity: 1, scale: 1, rotate: [0, spin, 0], y: [0, -12, 0] }}
      transition={{
        opacity: { duration: 0.8, delay },
        scale: { duration: 0.8, delay },
        rotate: { duration: 9, repeat: Infinity, ease: "easeInOut", delay },
        y: { duration: 6, repeat: Infinity, ease: "easeInOut", delay },
      }}
    >
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#9a9aa3" />
          <stop offset="0.52" stopColor="#f4f4f5" />
          <stop offset="0.75" stopColor="#3f3f46" />
          <stop offset="1" stopColor="#d4d4d8" />
        </linearGradient>
        <linearGradient id={`e${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
        </linearGradient>
        <filter id={`g${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <path d={path} fill="#fff" opacity="0.18" filter={`url(#g${id})`} />
      <path d={path} fill={`url(#b${id})`} stroke={`url(#e${id})`} strokeWidth="1.2" />
      <path d="M50 8 C52 36 60 44 50 50 C44 40 48 30 50 8 Z" fill="#fff" opacity="0.55" />
    </motion.svg>
  );
}
