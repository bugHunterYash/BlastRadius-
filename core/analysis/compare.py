# =============================================================================
# core.analysis.compare — before/after fairness-policed comparison (E2)
# =============================================================================
# WHY the fairness check polices OUR OWN pitch: the demo claims "same
# config, only the code changed". The tool refuses to let that claim be
# faked — if load shape, SLOs, or fault config differ between the two runs,
# every delta is stamped with a warning instead of being presented as
# architectural improvement. A comparison tool that doesn't check its own
# inputs is a number generator, not evidence.
#
# Deltas are (after − before): negative = improvement for latency/error/
# recovery metrics, positive for rps. None when EITHER side is missing —
# never a fabricated 0 (the schema comment on Comparison.deltas is the
# contract).
# =============================================================================

from __future__ import annotations

from core.schemas.report import Comparison, Report

# The headline metrics compared side-by-side. Keep this list explicit: a
# wildcard over every field would silently start comparing things that
# aren't comparable (e.g. request counts when run lengths differ).
_DELTA_KEYS = ("p95_ms", "error_rate", "rps", "recovery_time_s")


def _headline_phase(report: Report):
    """Which phase's numbers represent this report's outcome:
    fault phase for fault runs, worst (highest-multiplier) step for
    capacity, else the first phase."""
    if not report.phases:
        return None
    for p in report.phases:
        if p.phase == "fault":
            return p
    steps = [p for p in report.phases if p.phase == "load_step"]
    if steps:
        return max(steps, key=lambda p: p.load_multiplier)
    return report.phases[0]


def _slo_passed(report: Report) -> bool | None:
    """True = no phase breached any SLO; None = no phases at all (never
    claim pass/fail from missing data)."""
    if not report.phases:
        return None
    return not any(p.slo_breaches for p in report.phases)


def _fairness_warning(before: Report, after: Report) -> str | None:
    """Compare the parts of the configs that must match for the comparison
    to mean anything. Returns a warning sentence or None (fair)."""
    bl, al = before.config.load, after.config.load
    mismatches: list[str] = []
    if bl.baseline_rps != al.baseline_rps:
        mismatches.append("baseline_rps")
    if bl.multipliers != al.multipliers:
        mismatches.append("multipliers")
    if bl.step_duration_s != al.step_duration_s or bl.ramp_s != al.ramp_s:
        mismatches.append("step timing")
    if bl.endpoints != al.endpoints:
        mismatches.append("endpoints")
    if str(bl.target_base_url) != str(al.target_base_url):
        mismatches.append("target")
    if before.config.slo != after.config.slo:
        mismatches.append("SLOs")
    if before.config.fault != after.config.fault:
        mismatches.append("fault config")
    if before.config.type != after.config.type:
        mismatches.append("experiment type")
    if mismatches:
        return (
            "configs differ — not a fair comparison: "
            + ", ".join(mismatches)
        )
    return None


def compare(before: Report, after: Report) -> Comparison:
    """Build the Comparison object. Pure — both reports are stored data."""
    b_phase, a_phase = _headline_phase(before), _headline_phase(after)

    deltas: dict[str, float | None] = {}
    for key in _DELTA_KEYS:
        bv = getattr(b_phase, key, None) if b_phase else None
        av = getattr(a_phase, key, None) if a_phase else None
        # recovery_time lives on the report, not the phase:
        if key == "recovery_time_s":
            bv, av = before.recovery_time_s, after.recovery_time_s
        deltas[key] = (av - bv) if (bv is not None and av is not None) else None

    warning = _fairness_warning(before, after)

    return Comparison(
        before=before,
        after=after,
        fairness_warning=warning,
        deltas=deltas,
        slo_before_passed=_slo_passed(before),
        slo_after_passed=_slo_passed(after),
        recovered_before=before.recovered,
        recovered_after=after.recovered,
    )
