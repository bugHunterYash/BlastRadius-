# =============================================================================
# core.graph.classify — service kind heuristics
# =============================================================================
# WHY heuristics are two-pass and ordered:
#   Pass 1 settles UNAMBIGUOUS kinds from image names + container ports
#   (a postgres image is a database regardless of what it depends on).
#   Pass 2 settles AMBIGUOUS kinds (api/worker) that are defined by their
#   RELATIONSHIP to pass-1 kinds + their port shape.
#
# WHY `api` is checked before `frontend`:
#   Port 3000 is the Express default AND appears in the frontend port list.
#   A service on 3000 that depends on a datastore is an API; one that doesn't
#   (and is built from ./frontend) is a frontend. Ordering resolves the
#   overlap instead of random first-match-wins.
#
# ALL results are kind_inferred=True (schema default) — the user can override
# any kind in the inspector, which flips the flag to False (user-declared).
# =============================================================================

from __future__ import annotations

import re

from core.schemas.compose import ComposeModel, ComposeService
from core.schemas.graph import ServiceKind

# --- signal tables (single place to tune classification) -----------------------

DATABASE_IMAGE = re.compile(r"postgres|mysql|mariadb|mongo", re.I)
CACHE_IMAGE = re.compile(r"redis|valkey|memcached", re.I)
QUEUE_IMAGE = re.compile(r"rabbitmq|kafka|nats", re.I)
FRONTEND_IMAGE = re.compile(r"nginx|caddy|traefik", re.I)
FRONTEND_BUILD = re.compile(r"frontend|web|client", re.I)

DATABASE_PORTS = {5432, 3306, 27017}
CACHE_PORTS = {6379, 11211}
QUEUE_PORTS = {5672, 9092, 4222}
# Container ports that mean "serves HTTP at the edge". 3000 is deliberately
# here too, but the api rule runs FIRST so a 3000-port service with a
# datastore dependency never misclassifies as frontend.
HTTP_PORTS = {80, 443, 3000, 5173, 8000, 8080, 4000}


def container_ports(svc: ComposeService) -> list[int]:
    """Extract the CONTAINER-side port from each ports entry — the rightmost
    numeric segment, before any /proto suffix.

        '127.0.0.1:8080:80' → 80      (ip:host:container)
        '8080:80'           → 80      (host:container)
        '80'                → 80      (container only)
        '53/udp'            → 53      (proto stripped)

    WHY container, not host: classification cares what the SERVICE listens on,
    not which random host port Docker maps it to (host ports are also what the
    exposed-port gap rule inspects separately)."""
    out: list[int] = []
    for p in svc.ports:
        spec = p.split("/", 1)[0]          # drop /tcp|/udp
        last = spec.rsplit(":", 1)[-1]     # rightmost segment
        if last.isdigit():
            out.append(int(last))
    # `expose` is already container-side by definition: '3000' or [3000]
    for e in svc.expose:
        e_clean = e.split("/", 1)[0]
        if e_clean.isdigit():
            out.append(int(e_clean))
    return out


def _datastore_dep(svc: ComposeService, resolved_deps: dict[str, set[str]],
                   kinds_known: dict[str, ServiceKind]) -> bool:
    """Does this service depend (declared OR env-inferred) on a datastore?
    Needs `kinds_known` because api/worker are defined against pass-1 kinds —
    chicken-and-egg is why those kinds resolve in pass 2."""
    data_kinds = {ServiceKind.DATABASE, ServiceKind.CACHE, ServiceKind.QUEUE}
    targets = {d.service for d in svc.depends_on} | resolved_deps.get(svc.name, set())
    return any(kinds_known.get(t) in data_kinds for t in targets)


def classify_services(
    model: ComposeModel,
    resolved_deps: dict[str, set[str]] | None = None,
) -> dict[str, ServiceKind]:
    """Two-pass classification.

    resolved_deps: service → service names reached via env-var host detection
    (from edges.env_edges). Pass 2 uses it so a worker with NO depends_on but
    REDIS_HOST=demo-redis still classifies as worker — the demo's teaching
    moment depends on this.
    """
    resolved_deps = resolved_deps or {}
    services = model.services
    kinds: dict[str, ServiceKind] = {}

    # ---- pass 1: unambiguous (image / container ports) ----
    for name, svc in services.items():
        image = svc.image or ""
        ports = set(container_ports(svc))

        if DATABASE_IMAGE.search(image) or ports & DATABASE_PORTS:
            kinds[name] = ServiceKind.DATABASE
        elif CACHE_IMAGE.search(image) or ports & CACHE_PORTS:
            kinds[name] = ServiceKind.CACHE
        elif QUEUE_IMAGE.search(image) or ports & QUEUE_PORTS:
            kinds[name] = ServiceKind.QUEUE
        # else: unresolved — pass 2 decides

    # ---- pass 2: relationship-dependent ----
    for name, svc in services.items():
        if name in kinds:
            continue
        ports = set(container_ports(svc))
        image = svc.image or ""
        is_datastore_dep = _datastore_dep(svc, resolved_deps, kinds)

        # API: serves HTTP AND leans on a datastore.
        if ports & HTTP_PORTS and is_datastore_dep:
            kinds[name] = ServiceKind.API
            continue

        # Worker: publishes nothing AND leans on a datastore.
        # (no ports + datastore dep + NOT an api)
        if not svc.ports and is_datastore_dep:
            kinds[name] = ServiceKind.WORKER
            continue

        # Frontend: image/build signals are unambiguous; the port-only
        # fallback requires NO datastore dep so a 3000-port API never lands
        # here (api rule already ran and didn't match only when no dep).
        if (
            FRONTEND_IMAGE.search(image)
            or (svc.build and isinstance(svc.build, str) and FRONTEND_BUILD.search(svc.build))
            or (svc.build and isinstance(svc.build, dict)
                and FRONTEND_BUILD.search(str(svc.build.get("context", ""))))
            or (ports & HTTP_PORTS and not is_datastore_dep)
        ):
            kinds[name] = ServiceKind.FRONTEND
            continue

        kinds[name] = ServiceKind.UNKNOWN

    return kinds
