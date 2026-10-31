# =============================================================================
# core.report.builder — recommendation rule table + report finalization
# =============================================================================
# WHY a rule table and not an LLM (spec): recommendations must be traceable.
# Each rule here fires only on STORED rows (evidence indices, bottleneck
# classification, measured breaking point, recovery result) and every
# recommendation carries evidence_refs pointing back into Report.evidence —
# the UI draws the line from "fix this" to "here's why, with numbers".
#
# Rule application order IS the priority order within each level (stable —
# same Report → same list, byte-identical fix prompt).
#
# Confounded runs: causal rules are SKIPPED entirely (short-circuit at the
# top). A non-causal "re-run controlled" recommendation is emitted instead —
# see fix_prompt for the user-facing wording.
#
# finalize_report() does recommendations + fix_prompt in ONE pass so no
# stored Report can exist with recommendations but a stale prompt (or vice
# versa) — the two are a pair.
# =============================================================================

from __future__ import annotations

from core.report.fix_prompt import generate_fix_prompt
from core.schemas.metrics import EvidenceKind
from core.schemas.report import Recommendation, RecommendationPriority, Report


def recommendations_for(report: Report) -> list[Recommendation]:
    """Rule table: report facts → ordered recommendations. Pure function of
    the Report's stored fields (no graph, no DB, no clocks)."""
    if report.confounded:
        # Non-causal placeholder; full wording lives in generate_fix_prompt.
        return [
            Recommendation(
                priority=RecommendationPriority.P1,
                title="Re-run as a controlled experiment (single variable)",
                rationale=(
                    "This run changed multiple variables (fault + load ramp); "
                    "causal fixes cannot be justified from confounded data."
                ),
                evidence_refs=[],
            )
        ]

    recs: list[Recommendation] = []

    # --- rule 1: verified error evidence per service (P1) ---------------------
    by_service_errors: dict[str, list[int]] = {}
    for i, e in enumerate(report.evidence):
        if e.kind == EvidenceKind.REQUEST_ERRORS:
            by_service_errors.setdefault(e.service, []).append(i)
    for service, refs in by_service_errors.items():
        first = report.evidence[refs[0]]
        endpoints = sorted({report.evidence[i].metric.split(":", 1)[1]
                            for i in refs if ":" in report.evidence[i].metric})
        recs.append(Recommendation(
            priority=RecommendationPriority.P1,
            title=(
                f"Add graceful degradation for {service} on "
                f"{', '.join(endpoints)} (fallback/circuit breaker)"
            ),
            rationale=(
                f"Measured: {first.detail} (n={first.sample_count}). A service "
                f"dependency failed and requests to these routes failed with it."
            ),
            evidence_refs=refs,
        ))

    # --- rule 2: health flips (P1 — process died, not just slow) --------------
    by_service_health: dict[str, list[int]] = {}
    for i, e in enumerate(report.evidence):
        if e.kind == EvidenceKind.HEALTH_CHECK:
            by_service_health.setdefault(e.service, []).append(i)
    for service, refs in by_service_health.items():
        first = report.evidence[refs[0]]
        recs.append(Recommendation(
            priority=RecommendationPriority.P1,
            title=f"Add restart policy and healthcheck for {service}",
            rationale=(
                f"Measured: {first.detail}. The service went unhealthy during "
                f"the fault window while other traffic kept flowing."
            ),
            evidence_refs=refs,
        ))

    # --- rule 3: latency regressions (P2 — degraded, not dead) ----------------
    by_service_lat: dict[str, list[int]] = {}
    for i, e in enumerate(report.evidence):
        if e.kind == EvidenceKind.LATENCY_REGRESSION:
            by_service_lat.setdefault(e.service, []).append(i)
    for service, refs in by_service_lat.items():
        first = report.evidence[refs[0]]
        recs.append(Recommendation(
            priority=RecommendationPriority.P2,
            title=f"Reduce {service} latency under load (p95 regression)",
            rationale=f"Measured: {first.detail} (n={first.sample_count}).",
            evidence_refs=refs,
        ))

    # --- rule 4: bottleneck classification (P1/P2, non-causal-safe) -----------
    bottleneck_recs: dict[str, tuple[RecommendationPriority, str, str]] = {
        "db_connection_exhaustion": (
            RecommendationPriority.P1,
            "Increase database pool capacity or shorten queries",
            "Bottleneck classified as db_connection_exhaustion: pool saturated "
            "with waiting clients while traffic was still below the breaking point.",
        ),
        "cpu_bound": (
            RecommendationPriority.P1,
            "Add CPU headroom (scale horizontally or profile hot paths)",
            "Bottleneck classified as cpu_bound: target container CPU at its "
            "limit at the moment of breach.",
        ),
        "memory_pressure": (
            RecommendationPriority.P1,
            "Raise memory limits / investigate allocation growth",
            "Bottleneck classified as memory_pressure: memory at limit or "
            "OOM/restart observed during the run.",
        ),
        "load_generator_limited": (
            RecommendationPriority.P1,
            "Re-run with lower RPS — load generator saturated (results invalid)",
            "k6 dropped iterations: the generator could not apply the planned "
            "load, so the measured numbers understate what the app would see.",
        ),
        "downstream_latency": (
            RecommendationPriority.P2,
            "Optimize downstream dependency latency",
            "Bottleneck classified as downstream_latency: dependency latency "
            "rose while local CPU stayed below 70%.",
        ),
    }
    if report.bottleneck in bottleneck_recs:
        prio, title, why = bottleneck_recs[report.bottleneck]
        recs.append(Recommendation(
            priority=prio, title=title, rationale=why, evidence_refs=[],
        ))

    # --- rule 5: capacity headroom (P2) ---------------------------------------
    if report.first_breach_multiplier is not None:
        recs.append(Recommendation(
            priority=RecommendationPriority.P2,
            title=f"Prepare capacity headroom before {report.first_breach_multiplier}× load",
            rationale=(
                f"First SLO breach measured at {report.first_breach_multiplier}× "
                f"(highest passing: {report.highest_passing_multiplier})."
            ),
            evidence_refs=[],
        ))

    # --- rule 6: failed recovery (P1) -----------------------------------------
    if report.recovered is False and report.config.fault is not None:
        recs.append(Recommendation(
            priority=RecommendationPriority.P1,
            title="Fix post-fault connection recovery (reconnect/warm-up path)",
            rationale=(
                f"Service did not recover within "
                f"{report.config.fault.recovery_timeout_s}s of restore — "
                f"SLOs never held for {report.config.fault.recovery_stable_s}s "
                f"consecutively."
            ),
            evidence_refs=[],
        ))

    return recs


def finalize_report(report: Report, *, repo_hint: str | None = None) -> Report:
    """One pass: recommendations → fix prompt, both stored together.
    Deterministic — same input Report → identical output (tests diff JSON)."""
    recs = recommendations_for(report)
    staged = report.model_copy(update={"recommendations": recs})
    prompt = generate_fix_prompt(staged, repo_hint=repo_hint)
    return staged.model_copy(update={"fix_prompt": prompt})
