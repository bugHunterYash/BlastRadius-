import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyCommand({ command, className = "" }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard blocked: the command is still on screen to copy by hand.
        }
      }}
      className={`group inline-flex items-center gap-3 rounded-full border border-white/10 bg-ink-850/80 py-2.5 pl-5 pr-3 font-mono text-sm text-ink-100 backdrop-blur transition hover:border-white/25 ${className}`}
      aria-label={`Copy command: ${command}`}
    >
      <span className="text-ink-400">$</span>
      {command}
      <span className="grid h-7 w-7 place-items-center rounded-full bg-white/5 text-ink-300 group-hover:text-white">
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span key="ok" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
              <Check size={14} className="text-ok" />
            </motion.span>
          ) : (
            <motion.span key="cp" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
              <Copy size={14} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}
