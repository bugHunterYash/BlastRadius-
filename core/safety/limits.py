# =============================================================================
# core.safety.limits — hard-cap re-checks (defense-in-depth layer 2)
# =============================================================================
# THE THREE LAYERS (each must catch what the others miss):
#   layer 1  Pydantic LoadConfig validators   — rejects over-cap configs at
#             parse/create time (schemas/experiment.py)
#   layer 2  THIS MODULE                       — re-checks the config the
#             controller is ABOUT to execute against the SERVER's configured
#             caps. Catches: code constructing LoadConfig while bypassing
#             validation (model_construct), env caps LOOSENED past the
#             absolute ceiling, tampered values loaded from the DB
#   layer 3  k6 script options (maxVUs, thresholds, durations) — bounds the
#             load generator process itself even if Python logic is wrong
#
# WHY `effective_caps` refuses to LOOSEN: server env (MAX_RPS etc.) exists so
# ops can TIGHTEN limits on a weak box (laptop: max 100 RPS). If an operator
# sets MAX_RPS=5000 in .env, accepting it would silently disable layer 1.
# effective_caps clamps to the schema ceiling and records a violation so the
# misconfiguration surfaces instead of being ignored.
# =============================================================================

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from core.schemas.experiment import (
    CAP_MAX_DURATION_S,
    CAP_MAX_RPS,
    CAP_MAX_TIMEOUT_S,
    CAP_MAX_TOTAL_REQUESTS,
    CAP_MAX_VUS,
    LoadConfig,
)


@dataclass(frozen=True)
class Caps:
    """Effective caps after env-vs-ceiling reconciliation. Defaults are the
    absolute ceilings from the schema module — used when server env is
    absent (tests, standalone CLI)."""

    max_rps: int = CAP_MAX_RPS
    max_vus: int = CAP_MAX_VUS
    max_duration_s: int = CAP_MAX_DURATION_S
    max_total_requests: int = CAP_MAX_TOTAL_REQUESTS
    max_timeout_s: float = CAP_MAX_TIMEOUT_S


@dataclass(frozen=True)
class EffectiveCaps:
    """Result of reconciling server env against the absolute ceiling.

    `violations` = env values that tried to exceed the ceiling. They do NOT
    take effect (clamped) — but preflight surfaces them so the operator fixes
    .env instead of wondering why their '5000' behaves like 500."""

    caps: Caps
    violations: list[str]


def effective_caps(
    *,
    max_rps: int | None = None,
    max_vus: int | None = None,
    max_duration_s: int | None = None,
    max_total_requests: int | None = None,
    max_timeout_s: float | None = None,
) -> EffectiveCaps:
    """Clamp server-provided caps to the absolute ceilings (min of the two).
    None means 'use the ceiling' (env var unset)."""
    violations: list[str] = []

    def clamp(name: str, env_val: int | float | None, ceiling: int | float) -> int | float:
        if env_val is None:
            return ceiling
        if env_val > ceiling:
            violations.append(
                f"server cap {name}={env_val} exceeds the absolute ceiling "
                f"{ceiling}; clamped to {ceiling} — fix the .env value."
            )
            return ceiling
        return env_val

    return EffectiveCaps(
        caps=Caps(
            max_rps=int(clamp("MAX_RPS", max_rps, CAP_MAX_RPS)),
            max_vus=int(clamp("MAX_VUS", max_vus, CAP_MAX_VUS)),
            max_duration_s=int(clamp("MAX_DURATION_S", max_duration_s, CAP_MAX_DURATION_S)),
            max_total_requests=int(clamp("MAX_TOTAL_REQUESTS", max_total_requests, CAP_MAX_TOTAL_REQUESTS)),
            max_timeout_s=float(clamp("MAX_TIMEOUT_S", max_timeout_s, CAP_MAX_TIMEOUT_S)),
        ),
        violations=violations,
    )


def check_load_against_caps(load: LoadConfig, caps: Caps) -> list[str]:
    """Layer-2 validation: does this load config fit inside THESE caps?
    Returns violation strings ([] = clean). Preflight check #6 renders each
    one verbatim.

    WHY re-check values the schema already checked: between schema validation
    (create time) and controller execution, the config could have been
    constructed via model_construct (validation bypassed by design), read
    from the DB (tampered row), or the SERVER caps may be STRICTER than the
    schema ceilings (laptop at 100 RPS). This function is the authority for
    'may this exact object run NOW'.
    """
    violations: list[str] = []

    peak_rps = max(load.multipliers) * load.baseline_rps
    if peak_rps > caps.max_rps:
        violations.append(
            f"peak RPS {peak_rps:.0f} exceeds server cap {caps.max_rps} "
            f"(baseline {load.baseline_rps} x multiplier {max(load.multipliers)})."
        )

    if load.max_vus > caps.max_vus:
        violations.append(f"max_vus {load.max_vus} exceeds server cap {caps.max_vus}.")

    if load.total_duration_s > caps.max_duration_s:
        violations.append(
            f"total duration {load.total_duration_s}s exceeds server cap "
            f"{caps.max_duration_s}s."
        )

    if load.request_timeout_s > caps.max_timeout_s:
        violations.append(
            f"request timeout {load.request_timeout_s}s exceeds server cap "
            f"{caps.max_timeout_s}s."
        )

    # Total-request cap is a function of the others (spec: computed), but we
    # still check it explicitly: a long ramp of fast responses can cross 100k
    # even when every individual dimension looks legal.
    estimated = _estimate_total_requests(load)
    if estimated > caps.max_total_requests:
        violations.append(
            f"estimated total requests {estimated:,} exceeds server cap "
            f"{caps.max_total_requests:,}."
        )

    return violations


def _estimate_total_requests(load: LoadConfig) -> int:
    """Conservative estimate used only for the cap check: every step runs at
    its PEAK multiplier (upper bound — actual ramps spend the ramp seconds
    below peak, so real counts are lower). Overestimating here errs toward
    refusing a run, which is the correct direction for a safety check."""
    seconds = load.total_duration_s
    return int(seconds * max(load.multipliers) * load.baseline_rps)


def check_endpoints_against_allowlist(
    endpoints: Sequence[str],
    allowed_paths: Sequence[str],
) -> list[str]:
    """Optional path allowlist (server config). When `allowed_paths` is
    empty, all schema-validated paths are accepted (the demo's declared
    endpoint list comes from the target app config; if absent, shape-only
    validation already applies). Kept separate from RPS/VU caps because its
    failure message tells the user to extend an allowlist, not lower a load."""
    if not allowed_paths:
        return []
    violations: list[str] = []
    allowed_set = set(allowed_paths)
    for p in endpoints:
        if p not in allowed_set:
            violations.append(
                f"endpoint '{p}' is not in the target's declared endpoint list "
                f"(allowed: {', '.join(sorted(allowed_set))})."
            )
    return violations
