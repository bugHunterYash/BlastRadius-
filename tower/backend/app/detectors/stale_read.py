from app.detectors.base import IssueDraft


def stale_read(events, design, prior_versions: dict[str, int]) -> list[IssueDraft]:
    """An agent reads version n of a fact after version n+1 was written."""
    latest = dict(prior_versions)            # versions written before this run started
    last_write = {}
    out = []
    for e in events:                          # already sorted by ts
        if e.op == "write":
            latest[e.fact_key] = e.version
            last_write[e.fact_key] = e
        elif e.op == "read" and e.version is not None:
            newest = latest.get(e.fact_key)
            if newest is not None and e.version < newest:
                w = last_write.get(e.fact_key)
                by = f" by {w.agent}" if w else " before this run"
                out.append(IssueDraft(
                    "stale_read", e.agent, e.fact_key, [w.event_id if w else "", e.event_id],
                    f"{e.agent} read {e.fact_key} v{e.version} after v{newest} was written{by}.",
                ))
    return out
