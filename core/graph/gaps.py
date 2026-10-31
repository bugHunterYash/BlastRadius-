# =============================================================================
# core.graph.gaps — compose hygiene findings ("what's MISSING")
# =============================================================================
# WHY this exists alongside the dependency graph:
#   The graph shows what IS there; gaps show what SHOULD be there but isn't
#   (no healthcheck, no resource limits, single database). The plan's
#   Launchproof-inspired insight: judges and users grasp "red dashed badge =
#   missing piece" instantly — and every finding here is a deterministic rule
#   over the ComposeModel we already parsed (no extra I/O, no LLM).
#
# WHY each finding carries compose_path:
#   The YAML editor deep-links to it ("services.demo-api.healthcheck") so the
#   user lands on the exact place to add the missing block. A finding without
#   a location is advice; a finding WITH one is a task.
#
# Granularity decision:
#   - per-service (node badges): healthcheck, single-database, exposed-port —
#     they matter service-by-service.
#   - file-level (one row each): missing-limits, missing-restart — every
#     service lacking them would otherwise spray 5 identical badges.
# =============================================================================

from __future__ import annotations

from core.graph.classify import container_ports
from core.schemas.compose import ComposeModel
from core.schemas.graph import GapFinding, GapSeverity, ServiceKind

# kinds where a missing healthcheck is a real reliability hazard:
# the orchestrator/our preflight can't tell "up but broken" from "up".
_HEALTHCHECK_KINDS = {ServiceKind.API, ServiceKind.DATABASE, ServiceKind.CACHE}


def find_gaps(model: ComposeModel, kinds: dict[str, ServiceKind]) -> list[GapFinding]:
    """Evaluate the fixed rule table. Deterministic: same input → same output,
    ordering stable (file-level rules first, then per-service in service
    order) so tests and DB rows don't churn."""
    out: list[GapFinding] = []

    # ---- file-level rules ----------------------------------------------------

    if not any(s.limits and (s.limits.cpu or s.limits.memory) for s in model.services.values()):
        out.append(GapFinding(
            rule_id="missing-limits",
            severity=GapSeverity.LOW,
            service=None,
            detail="No service sets deploy.resources.limits (CPU/memory). "
                   "One runaway container can starve the whole host.",
            compose_path=None,
        ))

    if not any(s.restart for s in model.services.values()):
        out.append(GapFinding(
            rule_id="missing-restart",
            severity=GapSeverity.LOW,
            service=None,
            detail="No service sets a restart policy. Containers that exit "
                   "stay down until someone notices.",
            compose_path=None,
        ))

    # exactly one database → single point of failure; zero databases is fine
    # (not every stack stores state), >1 means replication already considered.
    db_services = [n for n, k in kinds.items() if k == ServiceKind.DATABASE]
    if len(db_services) == 1:
        db = db_services[0]
        out.append(GapFinding(
            rule_id="single-database",
            severity=GapSeverity.MEDIUM,
            service=db,
            detail=f"'{db}' is the only database service — a single point of "
                   f"failure with no replica declared.",
            compose_path=f"services.{db}",
        ))

    # no cache service while an API exists → every read hits the DB
    if kinds and not any(k == ServiceKind.CACHE for k in kinds.values()) \
            and any(k == ServiceKind.API for k in kinds.values()):
        out.append(GapFinding(
            rule_id="no-cache-heuristic",
            severity=GapSeverity.LOW,
            service=None,
            detail="An API service exists but no cache service is declared — "
                   "repeated reads likely hit the database directly.",
            compose_path=None,
        ))

    # ---- per-service rules (stable order = model.services insertion order) ---

    for name, svc in model.services.items():
        if kinds.get(name) in _HEALTHCHECK_KINDS and svc.healthcheck is None:
            out.append(GapFinding(
                rule_id="missing-healthcheck",
                severity=GapSeverity.MEDIUM,
                service=name,
                detail=f"'{name}' ({kinds.get(name, ServiceKind.UNKNOWN).value}) "
                       f"defines no healthcheck — orchestrators and preflight "
                       f"can't tell 'up but broken' from 'up'.",
                compose_path=f"services.{name}.healthcheck",
            ))

        # NOTE: per-service missing-limits was considered and rejected — every
        # service without limits would spray an identical badge. The file-level
        # 'missing-limits' rule above covers the stack once.

        # exposed port: published on all interfaces (no IP bind, or 0.0.0.0)
        for p in svc.ports:
            spec = p.split("/", 1)[0]
            parts = spec.split(":")
            if len(parts) == 3:
                ip = parts[0]
                publicly_bound = ip in ("0.0.0.0", "::", "[::]")
            elif len(parts) == 2:
                publicly_bound = True     # '8080:80' binds 0.0.0.0 by default
            else:
                publicly_bound = False    # container-only port, not published
            if publicly_bound:
                out.append(GapFinding(
                    rule_id="exposed-port",
                    severity=GapSeverity.MEDIUM,
                    service=name,
                    detail=f"'{name}' publishes port '{p}' on all interfaces "
                           f"(no loopback/private bind).",
                    compose_path=f"services.{name}.ports",
                ))
                break   # one finding per service is enough — it's a pattern, not a port list

    return out
