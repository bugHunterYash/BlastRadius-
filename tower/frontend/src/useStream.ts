import { useEffect, useState } from "react";

const NAMES = [
  "event.created", "run.status", "issue.created", "issue.updated",
  "digest.created", "fix.ready", "approval.recorded", "design.updated",
] as const;

export interface Live { name: string; at: number; data: Record<string, unknown> }

/** Subscribes to /v1/stream. `tick` changes on every message so views can refetch. */
export function useStream() {
  const [tick, setTick] = useState(0);
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<Live[]>([]);

  useEffect(() => {
    const es = new EventSource("/v1/stream");
    let timer: number | undefined;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const on = (name: string) => (e: MessageEvent) => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(e.data); } catch { /* keep empty */ }
      setFeed((f) => [{ name, at: Date.now(), data }, ...f].slice(0, 40));
      // Coalesce bursts (a run emits many events) into one refetch.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTick((t) => t + 1), 150);
    };
    NAMES.forEach((n) => es.addEventListener(n, on(n)));
    return () => { window.clearTimeout(timer); es.close(); };
  }, []);

  return { tick, connected, feed };
}
