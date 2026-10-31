# =============================================================================
# core.load.script — LoadConfig → rendered k6 script (Module C1)
# =============================================================================
# Safety model position: this is CAPS LAYER 3 of 3.
#   layer 1  Pydantic LoadConfig   (create time)
#   layer 2  core.safety.limits    (controller, before spawn)
#   layer 3  THIS module           (the script k6 actually executes)
# The numbers in the rendered options block (startRate, stage targets,
# maxVUs, timeout, thresholds) are computed FROM the validated LoadConfig —
# never from strings the user typed. User-derived values that must appear in
# the source (base URL, endpoint paths) go through json.dumps first, so a
# path like `/api/x";evil("` becomes a JSON string literal, not JS code.
#
# WHY stage math is per-multiplier (ramp THEN step), not "one pre-ramp":
#   LoadConfig.total_duration_s = len(multipliers) * (step + ramp) — the
#   schema's formula treats EACH step as (ramp into it + hold at it). The
#   rendered stages must sum to exactly that, or the controller's duration
#   watchdog and the actual k6 wall-clock disagree. Two k6 stages per
#   multiplier achieve it: {target, ramp} ramps the arrival rate linearly,
#   {target, step} holds it. With ramp_s=0 the ramp stage is omitted (k6
#   misbehaves on 0s stages) and the total is still len*step.
#
# WHY thresholds come from SafetyLimits, not SLOs: SLOs define "healthy" and
# are evaluated AFTER the run (analysis layer). Safety limits define "stop,
# the target is hurting" and must be enforced DURING it — so they alone are
# encoded as k6 abortOnFail thresholds. A config that breaches its own SLO
# should keep running (that IS the measurement); one that breaches safety
# must die.
#
# C2 (subprocess spawn) is intentionally NOT here — script GENERATION is
# pure and unit-tested without a k6 binary; runner.py (next step) consumes
# RenderedScript.
# =============================================================================

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from jinja2 import Template

from core.schemas.experiment import LoadConfig, SafetyLimits

_TEMPLATE_PATH = Path(__file__).resolve().parent / "template.js.j2"


@dataclass(frozen=True)
class RenderedScript:
    """Everything the controller + UI need from one render.

    source:  the exact JS k6 will execute (also shown read-only in the UI)
    stages:  the parsed stage list — the UI Traffic Twin renders the ramp
             preview from THIS, not by re-parsing the JS (single source of
             truth: both the script and the preview come from build_stages)
    peak_rps / estimated_requests: display-only estimates; the report always
             prefers MEASURED values (honesty rule: estimates are labeled).
    """

    source: str
    stages: list[dict]
    peak_rps: int | float
    estimated_requests: int
    threshold_error_rate: float
    threshold_p95_ms: float
    script_sha256: str = field(default="", repr=False)
    """Hash of `source`, computed at render time. The runner re-hashes the
    file on disk right before spawn and refuses to run on mismatch — blocks
    TOCTOU edits between render (shown in UI) and execute."""


def _fmt_num(x: float) -> int | float:
    """k6 stage targets: emit ints when integral (readable previews), floats
    otherwise (baseline 10 with multiplier 1.5 → 15; 10 with 0.75 → 7.5)."""
    return int(x) if float(x).is_integer() else x


def build_stages(load: LoadConfig) -> list[dict]:
    """Per-multiplier: ramp into target, then hold at target (see module
    header for why this shape matches total_duration_s exactly)."""
    stages: list[dict] = []
    for m in load.multipliers:
        target = _fmt_num(load.baseline_rps * m)
        if load.ramp_s > 0:
            stages.append({"target": target, "duration": f"{load.ramp_s}s"})
        stages.append({"target": target, "duration": f"{load.step_duration_s}s"})
    return stages


def estimate_requests(load: LoadConfig) -> int:
    """Closed-form estimate of total requests for the UI preview.

    Integral of the planned arrival rate: during a ramp from prev→target the
    average rate is (prev+target)/2; during a step it's target. Deliberately
    an OVER-estimate direction-safe number for display only — the report's
    request counts always come from measured k6 samples, never from here."""
    total = 0.0
    prev = float(load.baseline_rps)
    for m in load.multipliers:
        target = load.baseline_rps * m
        total += (prev + target) / 2 * load.ramp_s
        total += target * load.step_duration_s
        prev = target
    return int(total)


def generate_k6_script(
    load: LoadConfig,
    *,
    safety: SafetyLimits | None = None,
) -> RenderedScript:
    """Render the k6 script for this load config.

    Pure function: same inputs → byte-identical output (deterministic —
    integration tests diff rendered scripts; the UI script preview can be
    cached). `safety` supplies the abort thresholds; defaults to schema
    defaults (demo/CLI path)."""
    safety = safety or SafetyLimits()
    stages = build_stages(load)

    source = Template(_TEMPLATE_PATH.read_text(encoding="utf-8")).render(
        # json.dumps gives a double-quoted, escaped JS-compatible literal:
        # `/api/a";evil("` → `"/api/a\";evil("` — inert inside the string.
        base_url_json=json.dumps(str(load.target_base_url).rstrip("/")),
        endpoints_json=json.dumps(load.endpoints),
        timeout_json=json.dumps(f"{load.request_timeout_s}s"),
        start_rate=_fmt_num(load.baseline_rps),
        stages_json=json.dumps(stages),
        max_vus=load.max_vus,
        max_error_rate=safety.max_error_rate,
        max_p95_ms=int(safety.max_p95_ms),
    )

    return RenderedScript(
        source=source,
        stages=stages,
        peak_rps=_fmt_num(load.baseline_rps * max(load.multipliers)),
        estimated_requests=estimate_requests(load),
        threshold_error_rate=safety.max_error_rate,
        threshold_p95_ms=safety.max_p95_ms,
        script_sha256=hashlib.sha256(source.encode("utf-8")).hexdigest(),
    )
