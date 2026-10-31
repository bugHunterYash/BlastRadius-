"""Load, check and publish the intended agent design (design.json from our design tool, or YAML)."""

import json
from pathlib import Path

import httpx


def load(path: str | Path) -> dict:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if p.suffix in (".yaml", ".yml"):
        import yaml
        spec = yaml.safe_load(text)
    else:
        spec = json.loads(text)
    problems = check(spec)
    if problems:
        raise ValueError("bad design: " + "; ".join(problems))
    return spec


def check(spec: dict) -> list[str]:
    agents = set(spec.get("agents", []))
    problems = [] if agents else ["no agents"]
    for a, b in spec.get("handoffs", []):
        problems += [f"handoff names unknown agent {x!r}" for x in (a, b) if x not in agents]
    for a, perms in spec.get("permissions", {}).items():
        if a not in agents:
            problems.append(f"permissions for unknown agent {a!r}")
        problems += [f"{a}: bad permission kind {k!r}" for k in perms if k not in ("read", "write")]
    return problems


def push(path: str | Path, api_url: str = "http://localhost:8000") -> dict:
    r = httpx.put(f"{api_url}/v1/design", json=load(path), timeout=15)
    r.raise_for_status()
    return r.json()
