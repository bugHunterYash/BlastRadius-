# =============================================================================
# core.schemas.compose — normalized representation of a docker-compose file
# =============================================================================
# HOW it fits in the pipeline:
#   user YAML ──parse──▶ ComposeModel ──graph builder──▶ ArchitectureGraph
#
# WHY normalize into a dedicated model instead of passing raw dicts around:
#   - Compose allows two `depends_on` forms (list vs map) and two `environment`
#     forms (list vs map). Normalizing ONCE at the edge means every downstream
#     module (graph, gaps, preflight) sees one shape only.
#   - `unanalysed_keys` preserves keys we don't understand. WHY: silently
#     dropping them would lie to the user about what we analysed (honesty
#     principle). We list them as "not analysed" instead.
#
# WHAT IS DELIBERATELY NOT HERE:
#   - `env_file` contents — we record the filename only, never read it. Reading
#     env files could pull secrets into our DB; the spec forbids it.
#   - Anything runtime — this is pure config parsing, no Docker calls.
# =============================================================================

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ResourceLimits(BaseModel):
    """deploy.resources.limits — used by gap analysis (missing-limits rule)
    and later by bottleneck classification (cpu_bound needs the CPU limit as
    the denominator)."""

    cpu: str | None = None      # e.g. "0.5" or "500m"
    memory: str | None = None   # e.g. "256M"


class HealthcheckSpec(BaseModel):
    """Normalized healthcheck block. We only need to know WHETHER one exists
    (gap analysis) and its test command (preflight can reuse it). We don't
    re-implement Docker's healthcheck engine."""

    test: list[str] | str | None = None
    interval: str | None = None
    timeout: str | None = None
    retries: int | None = None


class DependsOnEntry(BaseModel):
    """One dependency edge from `depends_on`. Compose allows two forms:

        depends_on: [db]                        # short form
        depends_on: { db: { condition: ... } }  # long form

    We normalize BOTH to a list of these. `condition` matters because
    `service_healthy` vs `service_started` changes what "up" means for
    preflight."""

    service: str
    condition: Literal[
        "service_started", "service_healthy", "service_completed_successfully"
    ] = "service_started"


class ComposeService(BaseModel):
    """One service block, normalized. Field names match Compose keys where
    possible so a reader can diff against the original YAML easily."""

    name: str  # the key under `services:`
    image: str | None = None
    # Kept raw: we only inspect the build-context path for the frontend
    # classification heuristic (does it contain "frontend"/"web"?).
    build: str | dict[str, str] | None = None
    ports: list[str] = Field(default_factory=list)
    expose: list[str] = Field(default_factory=list)
    depends_on: list[DependsOnEntry] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    # environment normalized to a plain dict regardless of list/map form.
    # Default is an empty dict via default_factory — never share one dict
    # across instances (mutable-default trap).
    environment: dict[str, str] = Field(default_factory=dict)
    env_file: list[str] = Field(default_factory=list)  # names only, never read
    healthcheck: HealthcheckSpec | None = None
    networks: list[str] = Field(default_factory=list)
    labels: dict[str, str] = Field(default_factory=dict)
    restart: str | None = None
    limits: ResourceLimits | None = None
    # Keys present in the YAML that we don't model. Preserved, never dropped —
    # shown to the user as "not analysed" (honesty principle).
    unanalysed_keys: list[str] = Field(default_factory=list)

    @field_validator("environment", mode="before")
    @classmethod
    def _normalize_env(cls, v: object) -> dict[str, str]:
        """Compose allows environment as a map OR a list of KEY=VALUE strings.
        Normalize both to dict[str, str] here so edge detection only ever scans
        one shape. WHY at the schema layer: every caller benefits, not just one
        parser code path."""
        if v is None:
            return {}
        if isinstance(v, dict):
            # None value means "inherit from host" in Compose — store as empty.
            return {str(k): "" if val is None else str(val) for k, val in v.items()}
        if isinstance(v, list):
            out: dict[str, str] = {}
            for item in v:
                s = str(item)
                if "=" not in s:
                    # `KEY` with no =VALUE → empty string, matches Compose semantics
                    out[s.strip()] = ""
                    continue
                k, _, val = s.partition("=")
                out[k.strip()] = val
            return out
        raise ValueError("environment must be a map or a list of KEY=VALUE strings")


class ComposeModel(BaseModel):
    """The full parsed compose file. This is what the graph builder consumes
    and what gets stored (as source_yaml + derived graph) in
    architecture_graphs."""

    name: str | None = None  # top-level `name:` (Compose v2.4+)
    services: dict[str, ComposeService]
    networks: list[str] = Field(default_factory=list)
    # Parser-level warnings (e.g. "service X uses unsupported key 'volumes'").
    # Distinct from errors — warnings don't block the parse, errors do.
    warnings: list[str] = Field(default_factory=list)
    # Filename if uploaded, for display only. Never used for filesystem access.
    source_filename: str | None = None

    @field_validator("services")
    @classmethod
    def _non_empty(cls, v: dict[str, ComposeService]) -> dict[str, ComposeService]:
        # WHY: an empty services map is valid YAML but a useless compose file;
        # fail fast with a clear message instead of rendering an empty graph.
        if not v:
            raise ValueError(
                "No 'services' section found or it is empty. "
                "BlastRadius supports Compose files with a top-level 'services' map."
            )
        return v
