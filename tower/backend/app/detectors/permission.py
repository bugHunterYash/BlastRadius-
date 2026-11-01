from app.detectors.base import IssueDraft


def permission_leak(events, design, prior_versions=None) -> list[IssueDraft]:
    """An agent reads or writes a fact outside its permissions."""
    out = []
    for e in events:
        if e.op not in ("read", "write") or e.fact_key is None:
            continue
        allowed = design["permissions"].get(e.agent, {}).get(e.op, [])
        if e.fact_key not in allowed:
            out.append(IssueDraft(
                "permission_leak", e.agent, e.fact_key, [e.event_id],
                f"{e.agent} {'read' if e.op == 'read' else 'wrote'} {e.fact_key}, which it may not {e.op}.",
            ))
    return out
