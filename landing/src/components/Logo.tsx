export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#141418" stroke="#2a2a31" />
      <circle cx="16" cy="16" r="11" fill="none" stroke="#6b6b75" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="#c9c9cf" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="2.6" fill="#ff6a3d" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight text-white">
      <LogoMark />
      BlastRadius
    </span>
  );
}
