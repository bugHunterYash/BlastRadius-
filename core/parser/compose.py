# =============================================================================
# core.parser — docker-compose YAML → ComposeModel
# =============================================================================
# HOW this fits:  user file ──▶ parse_compose() ──▶ ComposeModel ──▶ graph
#
# WHY the parser is split into small private functions:
#   Each one maps to ONE validation rule from the spec's error table, so a
#   unit test can assert the exact message for that rule without wading
#   through unrelated checks. Error messages are part of our UI contract
#   (the YAML editor shows them inline with line numbers) — they must be
#   stable and specific, which means each must come from one place.
#
# SAFETY NOTES (this is the first thing that touches user input):
#   - yaml.safe_load ONLY. Never yaml.load: the unsafe loader can
#     instantiate arbitrary Python objects (yaml bomb / RCE).
#   - Alias-bomb guard: safe_load still allows billion-laughs via anchors —
#     a doc with 10k alias references to one anchor expands to a huge
#     structure. We count aliases while loading and reject over the cap.
#   - File size cap checked BEFORE parsing (256 KB) — cheap reject first.
#   - The parser never reads env_file contents, never touches the
#     filesystem beyond the bytes it was handed.
# =============================================================================

from __future__ import annotations

import io
from typing import Any

import yaml
from pydantic import ValidationError

from core.schemas.compose import (
    ComposeModel,
    ComposeService,
    DependsOnEntry,
    HealthcheckSpec,
    ResourceLimits,
)

# --- tunables (constants, not env: these are product decisions, not ops config)
MAX_FILE_BYTES = 256 * 1024      # spec §6.1: 256 KB
MAX_ALIASES = 100                # billion-laughs guard
MAX_SERVICES = 50                # a compose file beyond this is not our demo shape

# Keys we understand and model. Anything else goes to unanalysed_keys —
# preserved and listed as "not analysed", never silently dropped (honesty).
SUPPORTED_SERVICE_KEYS = frozenset({
    "image", "build", "ports", "expose", "depends_on", "links",
    "environment", "env_file", "healthcheck", "networks", "deploy",
    "labels", "restart",
})


class ComposeParseError(ValueError):
    """Parse failure with a user-facing message. Deliberately NOT a
    ValidationError: callers (API 422, CLI stderr, YAML editor gutter) render
    `message` directly. `line`/`column` are optional — only YAML syntax
    errors carry them; semantic errors (unknown dep, cycle) usually don't
    map to one line without a custom constructor (out of scope)."""

    def __init__(self, message: str, *, line: int | None = None, column: int | None = None):
        self.line = line
        self.column = column
        self.message = message
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        return {"message": self.message, "line": self.line, "column": self.column}


def _check_size(raw: bytes | str) -> None:
    size = len(raw.encode("utf-8")) if isinstance(raw, str) else len(raw)
    if size > MAX_FILE_BYTES:
        # Spec error table: report the actual size vs the cap in human units.
        raise ComposeParseError(
            f"File is {size / (1024 * 1024):.1f} MB; maximum supported size "
            f"is {MAX_FILE_BYTES // 1024} KB."
        )


def _load_yaml(text: str) -> Any:
    """The ONE path from text → data. Performs, in order:
      1. token scan with position-aware error mapping ('Line 14, column 3: …'
         — the exact format the spec's error table mandates and what the YAML
         editor parses for its gutter)
      2. alias-bomb guard (count BEFORE construction)
      3. safe_load (never yaml.load — see module header)
    WHY a single path: a second load route means a second place where the
    alias guard could be forgotten (it was — caught in review before shipping)."""
    try:
        tokens = list(yaml.scan(text))
    except yaml.YAMLError as e:
        raise _parse_error_with_position(e) from e

    alias_count = sum(1 for t in tokens if isinstance(t, yaml.AliasToken))
    if alias_count > MAX_ALIASES:
        raise ComposeParseError(
            f"File uses {alias_count} YAML aliases (limit {MAX_ALIASES}). "
            "Large alias expansions can exhaust memory."
        )

    try:
        return yaml.safe_load(text)
    except yaml.YAMLError as e:
        # Scan succeeded but construction failed (rare) — same error shape so
        # the editor always gets coordinates when they exist.
        raise _parse_error_with_position(e) from e


def _yaml_problem(e: yaml.YAMLError) -> str:
    """Format PyYAML's error the way the spec's error table shows it:
    'Line 14, column 3: mapping values are not allowed here' — we return only
    the problem text; the prefix is added by the caller that has the mark."""
    return str(getattr(e, "problem", None) or str(e))


def _parse_error_with_position(e: yaml.YAMLError) -> ComposeParseError:
    mark = getattr(e, "problem_mark", None)
    problem = _yaml_problem(e)
    if mark is not None:
        return ComposeParseError(
            f"Line {mark.line + 1}, column {mark.column + 1}: {problem}",
            line=mark.line + 1,
            column=mark.column + 1,
        )
    return ComposeParseError(problem)


# --- per-service normalization -------------------------------------------------

def _parse_ports(service_name: str, ports: Any) -> list[str]:
    """Validate port specs and normalize to strings. WHY validate here:
    Compose itself tolerates odd forms; we reject what we can't reason about
    (spec error table: "port '80:abc' is not a valid port mapping")."""
    if ports is None:
        return []
    if not isinstance(ports, list):
        raise ComposeParseError(f"Service '{service_name}': 'ports' must be a list.")
    out: list[str] = []
    for p in ports:
        s = str(p)
        if not _valid_port_spec(s):
            raise ComposeParseError(
                f"Service '{service_name}': port '{s}' is not a valid port mapping."
            )
        out.append(s)
    return out


def _valid_port_spec(spec: str) -> bool:
    """[ip:]host:container[/proto] where numbers are digits. Deliberately
    strict: our allowlist checks reason about these strings, so garbage in
    means a bypassed safety check later."""
    if "/" in spec:
        spec = spec.rsplit("/", 1)[0]
        if spec.endswith(("tcp", "udp")):  # proto was the last segment
            pass
    parts = spec.split(":")
    if len(parts) == 1:
        return parts[0].isdigit()          # container only: "80"
    if len(parts) == 2:
        return parts[0].isdigit() and parts[1].split("/")[0].isdigit()
    if len(parts) == 3:                    # ip:host:container
        ip, host, cont = parts
        return all(part.isdigit() for part in (host, cont.split("/")[0])) and ("." in ip or ip == "localhost")
    return False


def _parse_depends_on(service_name: str, value: Any) -> list[DependsOnEntry]:
    """Accept BOTH Compose forms and produce one shape (why: see schema):

        depends_on: [db]
        depends_on: { db: { condition: service_healthy } }
    """
    if value is None:
        return []
    if isinstance(value, list):
        return [DependsOnEntry(service=str(s)) for s in value]
    if isinstance(value, dict):
        entries: list[DependsOnEntry] = []
        for svc, conf in value.items():
            if isinstance(conf, dict):
                cond = str(conf.get("condition", "service_started"))
            else:
                cond = "service_started"
            # Unknown condition strings would crash Literal validation with an
            # unhelpful message — map to ComposeParseError with context instead.
            if cond not in ("service_started", "service_healthy", "service_completed_successfully"):
                raise ComposeParseError(
                    f"Service '{service_name}': depends_on condition '{cond}' "
                    f"is not supported (use service_started / service_healthy / "
                    f"service_completed_successfully)."
                )
            entries.append(DependsOnEntry(service=str(svc), condition=cond))  # type: ignore[arg-type]
        return entries
    raise ComposeParseError(
        f"Service '{service_name}': 'depends_on' must be a list or a map."
    )


def _parse_healthcheck(raw: Any) -> HealthcheckSpec | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ComposeParseError("'healthcheck' must be a map.")
    return HealthcheckSpec(
        test=raw.get("test"),
        interval=raw.get("interval"),
        timeout=raw.get("timeout"),
        retries=raw.get("retries"),
    )


def _parse_labels(raw: Any) -> dict[str, str]:
    """Labels matter enormously here: blastradius.env and
    blastradius.fault-allowed drive preflight. Normalize list/map forms so
    downstream checks read one shape."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return {str(k): "" if v is None else str(v) for k, v in raw.items()}
    if isinstance(raw, list):
        out: dict[str, str] = {}
        for item in raw:
            s = str(item)
            k, _, v = s.partition("=")
            out[k.strip()] = v
        return out
    raise ComposeParseError("'labels' must be a map or a list.")


def _parse_service(name: str, raw: Any) -> ComposeService:
    if not isinstance(raw, dict):
        raise ComposeParseError(f"Service '{name}' must be a map, got {type(raw).__name__}.")

    deploy = raw.get("deploy") or {}
    limits_raw = (deploy.get("resources") or {}).get("limits") if isinstance(deploy, dict) else None
    limits = (
        ResourceLimits(cpu=str(limits_raw.get("cpu")), memory=str(limits_raw.get("memory")))
        if isinstance(limits_raw, dict) and limits_raw
        else None
    )

    env_file = raw.get("env_file")
    if isinstance(env_file, str):
        env_file = [env_file]          # compose allows a bare string
    elif env_file is None:
        env_file = []

    networks = raw.get("networks")
    if isinstance(networks, dict):
        networks = list(networks.keys())   # compose map form: {net: {aliases: ...}}
    elif networks is None:
        networks = []

    expose = [str(x) for x in (raw.get("expose") or [])]
    links = [str(x) for x in (raw.get("links") or [])]

    unanalysed = sorted(k for k in raw if k not in SUPPORTED_SERVICE_KEYS)

    return ComposeService(
        name=name,
        image=raw.get("image"),
        build=raw.get("build"),
        ports=_parse_ports(name, raw.get("ports")),
        expose=expose,
        depends_on=_parse_depends_on(name, raw.get("depends_on")),
        links=links,
        environment=raw.get("environment"),   # schema validator normalizes
        env_file=[str(x) for x in env_file],  # names only — contents never read
        healthcheck=_parse_healthcheck(raw.get("healthcheck")),
        networks=[str(n) for n in networks],
        labels=_parse_labels(raw.get("labels")),
        restart=str(raw["restart"]) if raw.get("restart") is not None else None,
        limits=limits,
        unanalysed_keys=unanalysed,
    )


# --- file-level validation -----------------------------------------------------

def _check_references(services: dict[str, ComposeService]) -> None:
    """Every depends_on / links target must exist. Spec error:
    "Service 'api' depends on 'cache', which is not defined in services." """
    for name, svc in services.items():
        for dep in svc.depends_on:
            if dep.service not in services:
                raise ComposeParseError(
                    f"Service '{name}' depends on '{dep.service}', which is not "
                    f"defined in services."
                )
        for link in svc.links:
            target = link.split(":", 1)[0]   # "db:database" → "db" (alias form)
            if target not in services:
                raise ComposeParseError(
                    f"Service '{name}' links to '{target}', which is not "
                    f"defined in services."
                )


def _check_cycles(services: dict[str, ComposeService]) -> None:
    """DFS cycle detection over declared depends_on + links. WHY it matters:
    compose up would deadlock on a hard cycle, and our blast-radius BFS would
    still work (visited set) but the USER should know their config is broken —
    spec error: 'Dependency cycle detected: api → worker → api'."""
    # adjacency: name → its dependencies
    adj = {
        n: [d.service for d in s.depends_on] + [l.split(":", 1)[0] for l in s.links]
        for n, s in services.items()
    }
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in adj}
    stack: list[str] = []

    def visit(node: str) -> None:
        color[node] = GRAY
        stack.append(node)
        for nxt in adj.get(node, ()):
            if nxt not in color:
                continue  # dangling refs already reported by _check_references
            if color[nxt] == GRAY:
                # cycle: slice the stack from the first occurrence of nxt
                i = stack.index(nxt)
                cycle = " → ".join(stack[i:] + [nxt])
                raise ComposeParseError(f"Dependency cycle detected: {cycle}")
            if color[nxt] == WHITE:
                visit(nxt)
        stack.pop()
        color[node] = BLACK

    for n in adj:
        if color[n] == WHITE:
            visit(n)


# --- public API ----------------------------------------------------------------

def parse_compose(raw: bytes | str, *, filename: str | None = None) -> ComposeModel:
    """Full pipeline: size → YAML → structure → normalize → reference/cycle
    checks. Raises ComposeParseError with a user-facing message on any
    failure. Returns a ComposeModel ready for the graph builder."""
    _check_size(raw)
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw

    # Single load route: position errors + alias guard + safe_load (see _load_yaml).
    data = _load_yaml(text)

    if data is None:
        raise ComposeParseError("File is empty.")
    if not isinstance(data, dict):
        raise ComposeParseError(
            f"Expected a YAML mapping at the top level, got {type(data).__name__}."
        )

    if "services" not in data:
        raise ComposeParseError(
            "No 'services' section found. BlastRadius supports Compose files "
            "with a top-level 'services' map."
        )
    services_raw = data["services"]
    if not isinstance(services_raw, dict) or not services_raw:
        raise ComposeParseError("The 'services' section must be a non-empty map.")
    if len(services_raw) > MAX_SERVICES:
        raise ComposeParseError(
            f"File defines {len(services_raw)} services; maximum supported is {MAX_SERVICES}."
        )

    warnings: list[str] = []
    services: dict[str, ComposeService] = {}
    for name, body in services_raw.items():
        if not isinstance(name, str) or not name:
            raise ComposeParseError("Service names must be non-empty strings.")
        svc = _parse_service(name, body)
        if svc.unanalysed_keys:
            warnings.append(
                f"Service '{name}': keys not analysed: {', '.join(svc.unanalysed_keys)}."
            )
        services[name] = svc

    _check_references(services)
    _check_cycles(services)

    networks = data.get("networks")
    network_names = list(networks.keys()) if isinstance(networks, dict) else []

    return ComposeModel(
        name=str(data["name"]) if data.get("name") is not None else None,
        services=services,
        networks=[str(n) for n in network_names],
        warnings=warnings,
        source_filename=filename,
    )


def parse_compose_pydantic_error(e: ValidationError) -> ComposeParseError:
    """Bridge: if a ComposeModel field_validator fails (e.g. empty services),
    surface Pydantic's message as our UI-facing error type."""
    return ComposeParseError(e.errors()[0]["msg"])
