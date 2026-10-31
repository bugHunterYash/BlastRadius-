# =============================================================================
# core.graph.edges — dependency edge detection (declared / env / network)
# =============================================================================
# WHY a RawEdge intermediate before DependencyEdge:
#   Detection produces (source, target, source_kind, reason) tuples from three
#   independent detectors. Merging is a separate concern: one pair may be
#   supported by BOTH depends_on AND an env URL — we union sources/reasons
#   rather than keep two parallel edges. Splitting detect-vs-merge lets each
#   detector be unit-tested alone.
#
# DIRECTION CONTRACT (see schemas/graph.py): source = dependent,
# target = dependency. "api depends on redis" ⇒ source=api, target=redis.
#
# WHY redact passwords in reasons:
#   Reasons are stored in the DB, sent to the API, rendered in the inspector,
#   and (P2) may be sent to an LLM. DATABASE_URL commonly embeds credentials.
#   The compose SOURCE is already stored as uploaded (it's the user's own
#   data), but derived surfaces should never repeat a secret more times than
#   necessary.
# =============================================================================

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from core.schemas.compose import ComposeModel
from core.schemas.graph import DependencyEdge, EdgeSource, ServiceKind

# Env keys whose VALUE plausibly names a host. Conservative list — the goal is
# to catch DB/queue connection strings, not every string containing a dot.
_HOST_KEY_HINT = re.compile(r"HOST|ADDR|SERVER|DSN|URL|URI|ENDPOINT", re.I)
# host or host:port, no scheme (e.g. "demo-redis", "demo-redis:6379")
_HOST_VALUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*(?::\d+)?$")
# userinfo credentials inside a URL: scheme://user:pass@host → scheme://user:***@host
_USERINFO_SECRET = re.compile(r"(://[^:/@\s]+):[^@\s]+@")


def redact(value: str) -> str:
    """Mask the password segment of any URL userinfo. Applied to env values
    before they become edge reasons."""
    return _USERINFO_SECRET.sub(r"\1:***@", value)


@dataclass(frozen=True)
class RawEdge:
    """One detection result, pre-merge. `reason` is already redacted."""

    source: str
    target: str
    kind: EdgeSource
    reason: str


# --- detector 1: declared (depends_on / links) --------------------------------

def declared_edges(model: ComposeModel) -> list[RawEdge]:
    """High-confidence edges straight from config. WHY 'declared' wording in
    reasons: the inspector shows it verbatim — 'depends_on: demo-redis' is
    immediately checkable against the user's own YAML."""
    out: list[RawEdge] = []
    for name, svc in model.services.items():
        for dep in svc.depends_on:
            out.append(RawEdge(
                source=name, target=dep.service, kind=EdgeSource.DECLARED,
                reason=f"depends_on: {dep.service} (condition: {dep.condition})",
            ))
        for link in svc.links:
            target = link.split(":", 1)[0]
            out.append(RawEdge(
                source=name, target=target, kind=EdgeSource.DECLARED,
                reason=f"links: {link}",
            ))
    return out


# --- detector 2: env-var host detection ---------------------------------------

def _extract_host(value: str, key: str) -> str | None:
    """Pull a hostname candidate out of one env value.

    Two accepted shapes (see spec §6.4 inferred:env):
      1. URL with authority — redis://demo-redis:6379, postgres://u:p@db:5432/db
      2. Bare host[/host:port] when the KEY hints host-ness — REDIS_HOST=demo-redis

    WHY the key hint for shape 2: without it, NODE_ENV=test would produce a
    candidate host 'test', and PG_POOL_MAX=10 would produce '10' — junk edges
    everywhere. Shape 1 needs no hint because '://' is unambiguous."""
    if "://" in value:
        try:
            parts = urlsplit(value)
        except ValueError:
            return None
        return parts.hostname
    if _HOST_KEY_HINT.search(key) and _HOST_VALUE.match(value.strip()):
        return value.strip().split(":", 1)[0]
    return None


def env_edges(model: ComposeModel) -> list[RawEdge]:
    """Medium-confidence edges: an env value names another service as host."""
    out: list[RawEdge] = []
    names = set(model.services)
    for name, svc in model.services.items():
        for key, value in svc.environment.items():
            if not value:
                continue
            host = _extract_host(value, key)
            if host is None or host not in names or host == name:
                continue  # not a service / self-reference → no edge
            out.append(RawEdge(
                source=name, target=host, kind=EdgeSource.INFERRED_ENV,
                # Show the KEY and redacted value — reason is user-facing:
                # "env REDIS_URL = redis://demo-redis:6379"
                reason=f"env {key} = {redact(value)}",
            ))
    return out


# --- detector 3: shared custom network (low confidence, UI toggle) ------------

def network_edges(
    model: ComposeModel,
    kinds: dict[str, ServiceKind],
    already: list[RawEdge],
) -> list[RawEdge]:
    """Low-confidence edges from co-membership in a USER-DEFINED network.

    WHY the many guards — this detector is deliberately conservative:
      - only user-defined networks (a project's implicit 'default' network
        puts EVERY pair together; an edge from it says nothing)
      - direction points only TOWARD data services (database/cache/queue):
        connections are initiated app→data; drawing redis→api would invert
        reality. Between two non-data services there's no defensible
        direction, so we emit nothing.
      - skip pairs that already have ANY non-network edge in EITHER
        direction — a real signal exists already; this is fallback-only.

    All emitted edges get EdgeSource.INFERRED_NETWORK and are rendered only
    when the user enables the toggle. They also participate in blast radius
    ONLY when the caller opts in (impact.predicted_impact(include_network=))."""
    data_kinds = {ServiceKind.DATABASE, ServiceKind.CACHE, ServiceKind.QUEUE}
    non_data = set(kinds) - {n for n, k in kinds.items() if k in data_kinds}

    # Which custom networks exist? (top-level declared ≠ implicit default)
    custom_nets = {n for n in model.networks if n != "default"}
    # A service can also reference a network not declared top-level (compose
    # auto-creates it) — treat any per-service network name ≠ default as custom.
    for svc in model.services.values():
        custom_nets.update(n for n in svc.networks if n != "default")

    members: dict[str, set[str]] = {}
    for name, svc in model.services.items():
        for net in svc.networks:
            if net in custom_nets:
                members.setdefault(net, set()).add(name)

    # Pairs with a real (declared/env) edge, either direction — skip these.
    evidenced: set[frozenset[str]] = set()
    for e in already:
        if e.kind in (EdgeSource.DECLARED, EdgeSource.INFERRED_ENV):
            evidenced.add(frozenset((e.source, e.target)))

    out: list[RawEdge] = []
    seen: set[tuple[str, str]] = set()
    for net_name, net_members in members.items():
        ordered = sorted(net_members)
        for i, a in enumerate(ordered):
            for b in ordered[i + 1:]:
                if frozenset((a, b)) in evidenced:
                    continue
                # direction: non-data → data, only
                for src, tgt in ((a, b), (b, a)):
                    if (src, tgt) in seen:
                        continue
                    if kinds.get(src) in data_kinds:
                        continue          # source is a datastore → no outgoing guess
                    if kinds.get(tgt) not in data_kinds:
                        continue          # target not a datastore → no guess
                    seen.add((src, tgt))
                    out.append(RawEdge(
                        source=src, target=tgt, kind=EdgeSource.INFERRED_NETWORK,
                        reason=f"shared network: {net_name}",
                    ))
    return out


# --- merge --------------------------------------------------------------------

def merge_edges(raw: list[RawEdge]) -> list[DependencyEdge]:
    """Union per (source, target): sources list merges, reasons dedupe in
    first-seen order (stable output → deterministic tests, stable DB rows).

    NOTE: VERIFIED never appears here — verification is written exclusively by
    the analysis layer from stored evidence + experiment id (schemas enforce
    verified ⇒ verified_by non-empty)."""
    order: list[tuple[str, str]] = []
    acc: dict[tuple[str, str], dict[str, object]] = {}
    for e in raw:
        key = (e.source, e.target)
        if key not in acc:
            acc[key] = {"sources": set(), "reasons": []}
            order.append(key)
        bucket = acc[key]
        bucket["sources"].add(e.kind)           # type: ignore[attr-defined]
        reasons: list[str] = bucket["reasons"]  # type: ignore[assignment]
        if e.reason not in reasons:
            reasons.append(e.reason)

    out: list[DependencyEdge] = []
    for source, target in order:
        bucket = acc[(source, target)]
        sources: set[EdgeSource] = bucket["sources"]  # type: ignore[assignment]
        # Deterministic source order: enum value order, so JSON output is stable.
        ordered_sources = [s for s in EdgeSource if s in sources and s != EdgeSource.VERIFIED]
        out.append(DependencyEdge(
            source=source,
            target=target,
            sources=ordered_sources,
            reasons=list(bucket["reasons"]),  # type: ignore[arg-type]
        ))
    return out
