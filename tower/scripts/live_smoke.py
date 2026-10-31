"""Live smoke test against REAL providers through a running backend. Uses your Claude/Codex login.

    python scripts/live_smoke.py researcher          # Codex (per design/design.json)
    python scripts/live_smoke.py writer              # Claude
    python scripts/live_smoke.py writer --prompt "..." --run-id my-run

Prints what was captured. Exits non-zero unless the invocation completed, so a failed live run is
reported as failed, never as success.
"""

import argparse
import json
import os
import sys
import time

import httpx

DEFAULT_PROMPT = ("Read pricing.md in this folder and reply with only the current price of the Aqua bottle. "
                  "Do not modify any files.")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # Windows consoles default to cp1252
    p = argparse.ArgumentParser()
    p.add_argument("agent")
    p.add_argument("--prompt", default=DEFAULT_PROMPT)
    p.add_argument("--why", default="Live smoke test")
    p.add_argument("--run-id", default=f"live-{time.strftime('%H%M%S')}")
    p.add_argument("--api", default=os.environ.get("TOWER_API_URL", "http://localhost:8000"))
    p.add_argument("--timeout", type=float, default=300)
    a = p.parse_args()
    token = os.environ.get("TOWER_API_TOKEN") or os.environ.get("TOWER_INGEST_TOKEN", "dev-ingest-token-change-me")
    api = httpx.Client(base_url=a.api, headers={"Authorization": f"Bearer {token}"}, timeout=30)

    r = api.post(f"/v1/agents/{a.agent}/invoke", json={"run_id": a.run_id, "prompt": a.prompt, "why": a.why})
    if r.status_code >= 300:
        print(f"invoke refused: {r.status_code} {r.text}")
        return 2
    iid = r.json()["invocation_id"]
    print(f"invocation {iid} -> {r.json()['provider']} / {r.json()['runtime']}")

    end = time.monotonic() + a.timeout
    while time.monotonic() < end:
        inv = api.get(f"/v1/invocations/{iid}").json()
        if inv["status"] not in ("queued", "running") and not inv["running"]:
            break
        time.sleep(2)
    else:
        api.post(f"/v1/invocations/{iid}/cancel")
        print("timed out; cancel requested")
        return 3

    for k in ("status", "model", "provider_thread_id", "provider_turn_id", "input_tokens", "output_tokens", "error_message"):
        print(f"  {k:19} {inv[k]}")
    print(f"  {'final_response':19} {inv['final_response']!r}")
    print(f"  {'event_counts':19} {inv['event_counts']}")
    for e in api.get(f"/v1/invocations/{iid}/events").json():
        if e["event_type"] in ("message.delta", "command.output"):
            continue
        pl = {k: e["payload"].get(k) for k in ("model", "tool", "command", "exit_code", "path", "text", "message")
              if e["payload"].get(k) is not None}
        why = f" | why: {e['why'][:80]}" if e["why"] else ""
        print(f"  #{e['sequence']:<3} {e['event_type']:<22}{why} {json.dumps(pl, ensure_ascii=False)[:160]}")
    return 0 if inv["status"] == "completed" else 1


if __name__ == "__main__":
    sys.exit(main())
