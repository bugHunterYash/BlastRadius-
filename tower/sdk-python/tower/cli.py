"""tower CLI.

  tower design push design/design.json
  tower runs
  tower issues [--run RUN_ID]
"""

import argparse
import os
import sys

import httpx

from tower import design


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="tower")
    p.add_argument("--api", default=os.environ.get("TOWER_API_URL", "http://localhost:8000"))
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("design", help="publish the intended design")
    d.add_argument("action", choices=["push", "check"])
    d.add_argument("path")
    sub.add_parser("runs", help="latest runs with issue counts")
    i = sub.add_parser("issues", help="issues and their fixes")
    i.add_argument("--run")
    a = p.parse_args(argv)

    if a.cmd == "design":
        if a.action == "check":
            design.load(a.path)
            print("design ok")
        else:
            saved = design.push(a.path, a.api)
            print(f"design saved: {saved['design_id']}")
    elif a.cmd == "runs":
        for r in httpx.get(f"{a.api}/v1/runs", timeout=15).json():
            print(f"{r['run_id']:<28} {r['status']:<10} events={r['events']:<4} issues={r['issues']}")
    elif a.cmd == "issues":
        params = {"run_id": a.run} if a.run else {}
        for i in httpx.get(f"{a.api}/v1/issues", params=params, timeout=15).json():
            fix = i.get("fix") or {}
            print(f"[{i['status']}] {i['type']:<16} {i['agent']:<10} {i['fact_key'] or '':<10} {i.get('detail') or ''}")
            if fix:
                print(f"      fix ({fix['fix_type']} on {fix['target_agent']}): {fix['after']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
