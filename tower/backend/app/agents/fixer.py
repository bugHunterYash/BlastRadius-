"""Fixer (Claude): explains one issue and proposes exactly one fix, through a forced tool call.

It never applies anything. Without ANTHROPIC_API_KEY, or when Claude fails twice, a rule-based
template proposes the fix instead (model = "template"), so the approve loop always works.
"""

import asyncio
import json
import logging

from app import agent_config
from app.config import settings

log = logging.getLogger("tower.fixer")

PROPOSE_FIX = {
    "name": "propose_fix",
    "description": "Explain the issue and propose one concrete fix.",
    "input_schema": {
        "type": "object",
        "properties": {
            "explanation": {"type": "string", "description": "At most 3 sentences, plain words"},
            "fix_type": {"type": "string", "enum": ["prompt", "permission", "handoff_rule", "routing"]},
            "target_agent": {"type": "string"},
            "before": {"type": "string", "description": "Exact current text or setting"},
            "after": {"type": "string", "description": "Exact replacement"},
            "risk": {"type": "string", "enum": ["low", "medium", "high"]},
            "verify_by": {"type": "string", "description": "What a rerun should show"},
        },
        "required": ["explanation", "fix_type", "target_agent", "before", "after", "risk", "verify_by"],
    },
}

SYSTEM = ("You fix coordination bugs in multi-agent systems. Use only the evidence, design and "
          "config given. Propose the smallest change that prevents this issue. Prefer the style of "
          "past approved fixes and avoid patterns from rejected ones. For prompt, handoff_rule and "
          "routing fixes, 'before' must be text copied exactly from one field of the target agent's "
          "config. For permission fixes, 'before' and 'after' are the agent's permissions as JSON.")

_client = None


def enabled() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


def _claude():
    global _client
    if _client is None:
        from anthropic import AsyncAnthropic
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


async def _claude_fix(context: str) -> dict:
    last = None
    for _ in range(2):  # retry once
        try:
            resp = await asyncio.wait_for(
                _claude().messages.create(
                    model=settings.CLAUDE_MODEL,
                    max_tokens=1500,
                    system=SYSTEM,
                    tools=[PROPOSE_FIX],
                    tool_choice={"type": "tool", "name": "propose_fix"},
                    messages=[{"role": "user", "content": context}],
                ),
                settings.LLM_TIMEOUT_S,
            )
            return next(b.input for b in resp.content if b.type == "tool_use")
        except Exception as exc:
            last = exc
    raise last


def build_context(issue: dict, evidence_rows: list[str], design: dict, past: list[dict],
                  execution: list[str] | None = None) -> str:
    involved = {issue["agent"]} | {r.split()[1] for r in evidence_rows if len(r.split()) > 1}
    involved |= {a for h in design.get("handoffs", []) if issue["agent"] in h for a in h}
    design_part = {
        "handoffs": [h for h in design.get("handoffs", []) if set(h) & involved],
        "must_pass_through": {k: v for k, v in design.get("must_pass_through", {}).items() if k in involved},
        "permissions": {a: design.get("permissions", {}).get(a, {}) for a in sorted(involved)},
    }
    configs = "\n".join(f"--- {a}.yaml ---\n{agent_config.as_text(a)}" for a in sorted(involved))
    past_part = "\n".join(
        f"- {p['decision']}: {p['fix_type']} on {p['patch'].get('target_agent')}: "
        f"{p['patch'].get('before')!r} -> {p['patch'].get('after')!r}" + (f" (note: {p['note']})" if p.get("note") else "")
        for p in past
    ) or "(none yet)"
    return (
        f"Issue: {issue['type']} on agent {issue['agent']}, fact {issue['fact_key']}\n"
        f"Detector says: {issue.get('detail') or ''}\n\n"
        f"Evidence events:\n" + "\n".join(evidence_rows) + "\n\n"
        f"Design for the agents involved:\n{json.dumps(design_part, indent=2)}\n\n"
        f"Current agent configs:\n{configs}\n\n"
        f"Past decisions on {issue['type']} fixes:\n{past_part}\n"
        + ("\nRuntime executions of the agents involved (prompts, answers, visible actions):\n"
           + "\n".join(execution) + "\n" if execution else "")
    )


def _upstream(design: dict, agent: str) -> list[str]:
    return [a for a, b in design.get("handoffs", []) if b == agent]


def template_fix(issue: dict, design: dict, evidence: list[dict]) -> dict:
    """Deterministic fallback: one well-known fix per issue type."""
    agent, fact, kind = issue["agent"], issue["fact_key"], issue["type"]
    cfg = agent_config.load(agent)
    if kind == "stale_read":
        rule = cfg.get("handoff_rule", "")
        return {
            "explanation": f"{agent} used an old version of {fact}: it read v{evidence[-1].get('version')} after a "
                           f"newer version was saved. It should re-read the latest facts before it starts working.",
            "fix_type": "handoff_rule", "target_agent": agent, "before": rule,
            "after": f"{rule} AND recall latest version of each fact",
            "risk": "low", "verify_by": f"Rerun shows {agent} reading the latest version of {fact}",
        }
    if kind == "conflict":
        prompt = cfg.get("prompt", "")
        return {
            "explanation": f"{agent} overwrote {fact} without reading the version another agent had just saved, "
                           f"so that change was silently lost.",
            "fix_type": "prompt", "target_agent": agent, "before": prompt,
            "after": f"{prompt} Before writing {fact}, recall its latest version and build on it.",
            "risk": "low", "verify_by": f"Rerun shows {agent} reading {fact} before writing it",
        }
    if kind == "skipped_handoff":
        required = (design.get("must_pass_through", {}).get(agent) or _upstream(design, agent) or [agent])[0]
        sender = next((e["agent"] for e in evidence if e["op"] == "handoff"), None)
        if sender and sender != required:
            routing = agent_config.load(sender).get("routing", "")
            nxt = next((b for a, b in design.get("handoffs", []) if a == sender), required)
            return {
                "explanation": f"{sender} handed work straight to {agent}, so {required} never checked it. "
                               f"The design says {sender} hands off to {nxt}.",
                "fix_type": "routing", "target_agent": sender, "before": routing, "after": f"hand off to {nxt}",
                "risk": "low", "verify_by": f"Rerun shows {sender} -> {nxt} and {required} -> {agent} before {agent} writes",
            }
        rule = cfg.get("handoff_rule", "")
        return {
            "explanation": f"{agent} wrote {fact} without waiting for {required} to hand off.",
            "fix_type": "handoff_rule", "target_agent": agent, "before": rule,
            "after": f"start only when {required} hands off",
            "risk": "medium", "verify_by": f"Rerun shows {required} handing off to {agent} before it writes",
        }
    # permission_leak: stop the access rather than widen the design
    prompt = cfg.get("prompt", "")
    allowed = design.get("permissions", {}).get(agent, {}).get("read", [])
    return {
        "explanation": f"{agent} touched {fact}, which its permissions don't allow. "
                       f"Tell it to stay inside its own memory keys.",
        "fix_type": "prompt", "target_agent": agent, "before": prompt,
        "after": f"{prompt} Only read memory keys you are allowed to: {', '.join(allowed)}.",
        "risk": "low", "verify_by": f"Rerun shows no {fact} access by {agent}",
    }


async def propose_fix(issue: dict, design: dict, evidence: list[dict], evidence_rows: list[str],
                      past: list[dict], execution: list[str] | None = None) -> tuple[dict, str]:
    """Returns (proposal, model). Raises agent_config.FixRejected if the proposal fails the checks."""
    proposal, model = None, "template"
    if enabled():
        try:
            proposal = await _claude_fix(build_context(issue, evidence_rows, design, past, execution))
            model = settings.CLAUDE_MODEL
        except Exception as exc:
            log.warning("fixer fell back to template: %s", exc)
    if proposal is None:
        proposal = template_fix(issue, design, evidence)
    agent_config.check(proposal, design)
    return proposal, model
