# =============================================================================
# core.report.fix_prompt — deterministic "paste into your coding agent" artifact
# =============================================================================
# WHY no LLM (spec E1): every number in this prompt already passed grounding
# rules upstream (evidence rows, measured breaking point, recovery wording).
# An LLM at this stage could only INTRODUCE errors into verified data. The
# prompt is a template fill — byte-identical for the same Report, stored on
# the report row, so "Copy" today and "Copy" next week hand over the same
# artifact.
#
# WHY confounded runs get the recommendations SUPPRESSED (not watered down):
#   A fault_under_load run changed two variables; any causal "because redis
#   failed" sentence is unjustified (report.py confounded flag). A weak
#   recommendation is worse than none — it looks actionable while resting on
#   a claim we refused to make. Instead the prompt says: re-run controlled.
#
# Format contract: Markdown, sections in fixed order (repo → GOAL → MEASURED
# TODAY → FIX THESE → CONSTRAINTS → ACCEPTANCE). The UI renders it verbatim
# in a monospace panel; `br report --fix-prompt` prints the same bytes.
# =============================================================================

from __future__ import annotations

from core.schemas.report import RecommendationPriority, Report

_PRIORITY_ORDER = {
    RecommendationPriority.P1: 0,
    RecommendationPriority.P2: 1,
    RecommendationPriority.P3: 2,
}


def _measured_lines(report: Report) -> list[str]:
    """'MEASURED TODAY' bullets — only lines backed by stored data."""
    lines: list[str] = []

    if report.confounded:
        lines.append(
            "- WARNING: this run changed multiple variables (fault + load ramp); "
            "causal statements are suppressed."
        )
    elif report.evidence:
        first = report.evidence[0]
        lines.append(f"- {first.detail}")
        if len(report.evidence) > 1:
            lines.append(f"- {len(report.evidence)} measured impact rows total "
                         f"(services: {', '.join(sorted(report.affected_services))})")
    else:
        lines.append("- No measurable impact recorded (no evidence rows).")

    # Breaking point — wording mirrors report schema comments exactly.
    if report.config.type.value == "capacity" or report.tested_multipliers:
        if report.first_breach_multiplier is not None and report.highest_passing_multiplier is not None:
            lines.append(
                f"- Breaking point: between {report.highest_passing_multiplier}× "
                f"and {report.first_breach_multiplier}× load"
            )
        elif report.highest_passing_multiplier is not None:
            lines.append(
                f"- Breaking point: no breach up to {report.highest_passing_multiplier}× "
                f"(limit not determined)"
            )
        elif report.first_breach_multiplier is not None:
            lines.append(f"- Breaking point: first step {report.first_breach_multiplier}× already breached")
        else:
            lines.append("- Breaking point: not measured")

    # Recovery — only for fault experiments; wording is the stored one.
    if report.config.fault is not None:
        if report.recovered is True and report.recovery_time_s is not None:
            lines.append(
                f"- Recovery after {report.config.fault.kind.value} of "
                f"{report.config.fault.target_service}: {report.recovery_time_s:.0f}s"
            )
        elif report.recovered is False:
            lines.append(
                f"- Recovery after {report.config.fault.kind.value} of "
                f"{report.config.fault.target_service}: not recovered within "
                f"{report.config.fault.recovery_timeout_s}s"
            )
        else:
            lines.append("- Recovery: not measured")

    if report.stop_reason:
        lines.append(f"- Run stopped: {report.stop_reason}")

    return lines


def _goal_target(report: Report) -> str:
    if report.config.fault is not None:
        return (f"{report.config.fault.kind.value} of "
                f"{report.config.fault.target_service} under constant load")
    if report.first_breach_multiplier is not None:
        return f"load of {report.first_breach_multiplier}x (first measured breach)"
    if report.highest_passing_multiplier is not None:
        return f"load above {report.highest_passing_multiplier}x"
    return "the tested load profile"


_BOTTLENECK_ACCEPTANCE = {
    "db_connection_exhaustion":
        "DB pool stays below 90% active connections at the previously breaching load",
    "cpu_bound":
        "target container CPU stays below 90% at the previously breaching load",
    "memory_pressure":
        "no OOM kills and memory stays below 90% of the container limit",
    "downstream_latency":
        "downstream dependency p95 stays within SLO at the previously breaching load",
    "load_generator_limited":
        "load generator reports zero dropped iterations",
    "unknown": "",
}


def generate_fix_prompt(report: Report, *, repo_hint: str | None = None) -> str:
    """Fill the fix-prompt template from a Report. Pure + deterministic: no
    clock, no randomness, no network. Raises nothing — a report with zero
    evidence/recommendations still produces a valid (if terse) prompt; the
    confounded case is handled in _measured_lines + FIX THESE below."""
    repo = repo_hint or "the uploaded compose stack"
    out: list[str] = []
    out.append(f"You are working in this repository: {repo}")
    out.append("")
    out.append(f"GOAL: Make this app survive {_goal_target(report)} without changing behavior or API responses.")
    out.append("")
    out.append("MEASURED TODAY:")
    out.extend(_measured_lines(report))
    out.append("")

    out.append("FIX THESE, IN ORDER:")
    if report.confounded:
        # Suppression, not watering down (module header).
        out.append("1. [P1] Re-run as a controlled experiment (single variable)")
        out.append("   Why: this run changed both fault and load — no causal fix can be")
        out.append("   justified from confounded data.")
        out.append("   Evidence: none — recommendations are suppressed for confounded runs.")
    elif report.recommendations:
        ordered = sorted(
            enumerate(report.recommendations),
            key=lambda pair: (_PRIORITY_ORDER[pair[1].priority], pair[0]),
        )
        for n, (_, rec) in enumerate(ordered, start=1):
            out.append(f"{n}. [{rec.priority.value}] {rec.title}")
            out.append(f"   Why: {rec.rationale}")
            refs = []
            for idx in rec.evidence_refs:
                if 0 <= idx < len(report.evidence):
                    e = report.evidence[idx]
                    base = "n/a" if e.baseline_value is None else e.baseline_value
                    obs = "n/a" if e.observed_value is None else e.observed_value
                    refs.append(f"{e.metric}: {base} → {obs}")
            out.append(
                "   Evidence: " + ("; ".join(refs) if refs else "none recorded")
            )
    else:
        out.append("1. [P3] Review measurements — no automated recommendation matched")
        out.append("   Why: no evidence rows, bottleneck unknown, no breach recorded.")
        out.append("   Evidence: none")
    out.append("")

    out.append("CONSTRAINTS")
    out.append("- Keep routes, request/response shapes, existing tests passing.")
    out.append("- Config via env vars with defaults in .env.example.")
    out.append("- Don't remove features.")
    out.append("")

    out.append("ACCEPTANCE CRITERIA")
    accept = (f'- Re-run experiment "{report.config.name}" with the same config: '
              f"all SLOs hold")
    if report.config.fault is not None:
        accept += (f", recovery completes within "
                   f"{report.config.fault.recovery_timeout_s}s")
    elif report.first_breach_multiplier is not None:
        accept += f", including {report.first_breach_multiplier}× load"
    elif report.highest_passing_multiplier is not None:
        accept += f", including {report.highest_passing_multiplier}× load"
    out.append(accept + ".")
    b_acc = _BOTTLENECK_ACCEPTANCE.get(report.bottleneck, "")
    if b_acc:
        out.append(f"- {b_acc}.")

    return "\n".join(out)
