"""Read, check and apply fixes to the demo agents' config files (demo-agents/config/<agent>.yaml)."""

import json
import subprocess

import yaml

from app.config import settings

TEXT_FIX_TYPES = ("prompt", "handoff_rule", "routing")
FIX_TYPES = (*TEXT_FIX_TYPES, "permission")


class FixRejected(ValueError):
    pass


def _path(agent: str):
    if not agent.replace("_", "").replace("-", "").isalnum():
        raise FixRejected(f"bad agent name {agent!r}")
    return settings.AGENT_CONFIG_DIR / f"{agent}.yaml"


def load(agent: str) -> dict:
    p = _path(agent)
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {} if p.exists() else {}


def as_text(agent: str) -> str:
    p = _path(agent)
    return p.read_text(encoding="utf-8") if p.exists() else "(no config file)"


def _field_holding(cfg: dict, before: str) -> str:
    """The one text field that contains `before` exactly once."""
    hits = [(k, v.count(before)) for k, v in cfg.items() if isinstance(v, str) and before and before in v]
    total = sum(n for _, n in hits)
    if total != 1:
        raise FixRejected(f"'before' must match the current config exactly once, matched {total} times")
    return hits[0][0]


def check(proposal: dict, design: dict) -> None:
    """Raise FixRejected unless the proposal can be applied as written."""
    if proposal.get("fix_type") not in FIX_TYPES:
        raise FixRejected(f"unknown fix_type {proposal.get('fix_type')!r}")
    target = proposal.get("target_agent")
    if target not in design.get("agents", []):
        raise FixRejected(f"target_agent {target!r} is not in the design")
    if proposal["fix_type"] == "permission":
        try:
            before, after = json.loads(proposal["before"]), json.loads(proposal["after"])
        except (TypeError, ValueError) as exc:
            raise FixRejected("permission fixes need JSON before/after") from exc
        if before != design.get("permissions", {}).get(target, {}):
            raise FixRejected("'before' does not match the agent's current permissions")
        if not isinstance(after, dict) or not all(isinstance(after.get(k, []), list) for k in ("read", "write")):
            raise FixRejected("'after' must look like {\"read\": [...], \"write\": [...]}")
    else:
        _field_holding(load(target), proposal["before"])


def apply_text_fix(agent: str, before: str, after: str) -> None:
    cfg = load(agent)
    field = _field_holding(cfg, before)
    cfg[field] = cfg[field].replace(before, after, 1)
    _path(agent).write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True, width=1000), encoding="utf-8")


def git_commit(message: str) -> None:
    """Commit the config change so any fix can be rolled back. Off unless APPLY_GIT_COMMIT=true."""
    if not settings.APPLY_GIT_COMMIT:
        return
    cwd = settings.AGENT_CONFIG_DIR
    subprocess.run(["git", "add", "."], cwd=cwd, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", message], cwd=cwd, check=False, capture_output=True)
