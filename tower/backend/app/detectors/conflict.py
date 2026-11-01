from app.detectors.base import IssueDraft


def conflict(events, design, prior_versions=None) -> list[IssueDraft]:
    """Two agents write the same fact in one run and the second never saw the first one's version."""
    last_write = {}                           # fact -> latest write event in this run
    seen: dict[tuple[str, str], set[int]] = {}  # (agent, fact) -> versions read or written
    out = []
    for e in events:
        if e.op not in ("read", "write") or e.version is None:
            continue
        key = (e.agent, e.fact_key)
        if e.op == "write":
            prev = last_write.get(e.fact_key)
            if prev and prev.agent != e.agent and prev.version not in seen.get(key, set()):
                out.append(IssueDraft(
                    "conflict", e.agent, e.fact_key, [prev.event_id, e.event_id],
                    f"{e.agent} overwrote {e.fact_key} v{prev.version} from {prev.agent} without reading it.",
                ))
            last_write[e.fact_key] = e
        seen.setdefault(key, set()).add(e.version)
    return out
