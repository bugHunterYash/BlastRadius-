from app.detectors.base import IssueDraft


def skipped_handoff(events, design, prior_versions=None) -> list[IssueDraft]:
    """An agent writes output without the handoff the design requires earlier in the run.

    Before an agent's write: if the design gives it upstream agents, one of them must have handed
    off to it; and every agent in must_pass_through[agent] must have finished (handed off) first.
    """
    upstream: dict[str, set[str]] = {}
    for a, b in design.get("handoffs", []):
        upstream.setdefault(b, set()).add(a)
    must = design.get("must_pass_through", {})
    received: dict[str, set[str]] = {}       # agent -> agents that handed off to it
    finished: set[str] = set()               # agents that have handed off to anyone
    last_handoff_to: dict[str, str] = {}     # agent -> event_id of the handoff it got
    flagged = set()
    out = []
    for e in events:
        if e.op == "handoff":
            received.setdefault(e.target_agent, set()).add(e.agent)
            finished.add(e.agent)
            last_handoff_to[e.target_agent] = e.event_id
        elif e.op == "write" and e.agent not in flagged:
            ups = upstream.get(e.agent, set())
            missing = [] if not ups or received.get(e.agent, set()) & ups else [" or ".join(sorted(ups))]
            missing += [a for a in must.get(e.agent, []) if a not in finished and a not in missing]
            if missing:
                flagged.add(e.agent)
                evidence = [e.event_id] + ([last_handoff_to[e.agent]] if e.agent in last_handoff_to else [])
                got = sorted(received.get(e.agent, set()))
                via = f" (got it from {', '.join(got)})" if got else " (no handoff at all)"
                out.append(IssueDraft(
                    "skipped_handoff", e.agent, e.fact_key, evidence,
                    f"{e.agent} wrote {e.fact_key} before {', '.join(missing)} handed off{via}.",
                ))
    return out
