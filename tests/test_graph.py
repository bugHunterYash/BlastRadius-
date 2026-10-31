# =============================================================================
# Graph tests — run: python tests/test_graph.py
# =============================================================================
# The load-bearing assertions (from spec §16 test matrix T3/T4):
#   T3: demo-worker MUST get inferred:env edges (no depends_on — teaching moment)
#   T4: predicted blast radius of demo-redis = {api, worker, frontend} w/ paths
# Plus: merge behavior, password redaction, gap rule output, network toggling.
# =============================================================================

from __future__ import annotations

import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from core.graph import build_graph, predicted_impact
from core.parser import parse_compose
from core.schemas.graph import EdgeSource, GapSeverity, ServiceKind

FIXTURES = Path(__file__).resolve().parent / "fixtures"

PASS = 0
FAIL = 0


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"  PASS  {name}")


def fail(name: str, detail: str) -> None:
    global FAIL
    FAIL += 1
    print(f"  FAIL  {name}: {detail}")


def assert_eq(name: str, actual, expected) -> None:
    if actual == expected:
        ok(name)
    else:
        fail(name, f"expected {expected!r}, got {actual!r}")


def main() -> int:
    # ---------- build from the demo fixture ----------
    model = parse_compose((FIXTURES / "demo-compose.yaml").read_text(encoding="utf-8"),
                          filename="demo-compose.yaml")
    graph = build_graph(model, graph_id=UUID(int=0), name="demo")

    # ---------- T3-adjacent: classification (worker via INFERRED deps) --------
    kinds = {n.id: n.kind for n in graph.nodes}
    assert_eq("kind demo-frontend is frontend", kinds["demo-frontend"], ServiceKind.FRONTEND)
    assert_eq("kind demo-api is api", kinds["demo-api"], ServiceKind.API)
    assert_eq("kind demo-redis is cache", kinds["demo-redis"], ServiceKind.CACHE)
    assert_eq("kind demo-postgres is database", kinds["demo-postgres"], ServiceKind.DATABASE)
    assert_eq("kind demo-worker is worker (env-inferred deps)", kinds["demo-worker"], ServiceKind.WORKER)

    # ---------- fault_allowed labels parsed onto nodes ------------------------
    allowed = {n.id: n.fault_allowed for n in graph.nodes}
    assert_eq("redis node fault_allowed", allowed["demo-redis"], True)
    assert_eq("api node fault_allowed", allowed["demo-api"], True)
    assert_eq("postgres node NOT fault_allowed", allowed["demo-postgres"], False)
    assert_eq("worker node NOT fault_allowed", allowed["demo-worker"], False)

    # ---------- edge inventory -------------------------------------------------
    edge_map = {(e.source, e.target): e for e in graph.edges}
    expected_pairs = {
        ("demo-frontend", "demo-api"),        # declared
        ("demo-api", "demo-redis"),           # declared + env (merged!)
        ("demo-api", "demo-postgres"),        # declared + env (merged!)
        ("demo-worker", "demo-redis"),        # env only — INFERRED
        ("demo-worker", "demo-postgres"),     # env only — INFERRED
        ("demo-frontend", "demo-redis"),      # network (toggle)
        ("demo-frontend", "demo-postgres"),   # network (toggle)
    }
    assert_eq("edge set exactly as predicted", set(edge_map), expected_pairs)

    # ---------- merged sources (declared ∪ env on the same pair) --------------
    api_redis = edge_map[("demo-api", "demo-redis")]
    assert_eq(
        "api→redis carries BOTH declared and env sources",
        sorted(s.value for s in api_redis.sources),
        ["declared", "inferred:env"],
    )
    if len(api_redis.reasons) >= 2:
        ok("api→redis has one reason per source")
    else:
        fail("api→redis reasons", f"expected >=2 reasons, got {api_redis.reasons}")

    # ---------- T3: worker edges are INFERRED with reasons --------------------
    w_redis = edge_map[("demo-worker", "demo-redis")]
    assert_eq("worker→redis sources = env only", list(w_redis.sources), [EdgeSource.INFERRED_ENV])
    if "REDIS_HOST" in (w_redis.reasons[0] if w_redis.reasons else ""):
        ok("worker→redis reason names REDIS_HOST")
    else:
        fail("worker→redis reason", f"got {w_redis.reasons}")

    w_pg = edge_map[("demo-worker", "demo-postgres")]
    assert_eq("worker→postgres sources = env only", list(w_pg.sources), [EdgeSource.INFERRED_ENV])

    # ---------- password redaction in reasons ---------------------------------
    api_pg = edge_map[("demo-api", "demo-postgres")]
    joined = " | ".join(api_pg.reasons)
    if "demo:demo@" in joined:
        fail("redaction", f"plaintext password leaked in reasons: {joined}")
    elif "demo:***@" in joined and "DATABASE_URL" in joined:
        ok("DATABASE_URL reason redacts the password")
    else:
        fail("redaction", f"unexpected reason shape: {joined}")

    # ---------- network edges are separate + carry their source ----------------
    net_edges = [e for e in graph.edges if EdgeSource.INFERRED_NETWORK in e.sources]
    net_pairs = {(e.source, e.target) for e in net_edges}
    assert_eq(
        "network edges = frontend→{redis, postgres} only",
        net_pairs,
        {("demo-frontend", "demo-redis"), ("demo-frontend", "demo-postgres")},
    )
    if all(EdgeSource.INFERRED_NETWORK == e.sources[0] for e in net_edges):
        ok("network edges are network-only (no stronger evidence existed)")
    else:
        fail("network edge sources", "expected network source first/only")

    # ---------- gaps -----------------------------------------------------------
    rule_ids = [g.rule_id for g in graph.gaps]
    assert_eq("gap rules on demo fixture", sorted(rule_ids),
              ["missing-limits", "missing-restart", "single-database"])
    single_db = next(g for g in graph.gaps if g.rule_id == "single-database")
    assert_eq("single-database attaches to demo-postgres", single_db.service, "demo-postgres")
    assert_eq("single-database severity", single_db.severity, GapSeverity.MEDIUM)
    if single_db.compose_path == "services.demo-postgres":
        ok("single-database compose_path deep-links")
    else:
        fail("single-database compose_path", f"got {single_db.compose_path}")

    # ---------- warnings carried (unanalysed volumes) --------------------------
    if any("volumes" in w for w in graph.warnings):
        ok("graph.warnings carries 'volumes not analysed'")
    else:
        fail("graph.warnings", f"got {graph.warnings}")

    # ---------- T4: predicted blast radius of demo-redis ------------------------
    impact = predicted_impact(graph, "demo-redis")   # default: no network edges
    by_service = {p.impacted_service: p for p in impact.impacted}
    assert_eq(
        "predicted impact (default) = api, worker, frontend",
        sorted(by_service),
        ["demo-api", "demo-frontend", "demo-worker"],
    )

    # paths: direct hits vs transitive
    assert_eq("demo-api path is direct", by_service["demo-api"].via, ["demo-api"])
    assert_eq("demo-worker path is direct", by_service["demo-worker"].via, ["demo-worker"])
    assert_eq("demo-frontend path goes via demo-api",
              by_service["demo-frontend"].via, ["demo-api", "demo-frontend"])

    # reasons tell the full chain (accumulated across hops)
    fe_reasons = by_service["demo-frontend"].reasons
    if any("REDIS_URL" in r for r in fe_reasons) and any("depends_on: demo-api" in r for r in fe_reasons):
        ok("frontend path reasons span both hops (env + declared)")
    else:
        fail("frontend path reasons", f"got {fe_reasons}")

    if all(s in {EdgeSource.DECLARED, EdgeSource.INFERRED_ENV} for s in impact.edge_sources_used):
        ok("default impact uses only declared+env sources")
    else:
        fail("edge_sources_used", f"got {impact.edge_sources_used}")

    # ---------- impact with network edges opted in -----------------------------
    impact_net = predicted_impact(graph, "demo-redis", include_network=True)
    fe_net = next(p for p in impact_net.impacted if p.impacted_service == "demo-frontend")
    # fe→redis network edge is a DIRECT hop: should now be path [demo-frontend]
    assert_eq("with network toggle: frontend is a DIRECT impact",
              fe_net.via, ["demo-frontend"])
    if any("shared network" in r for r in fe_net.reasons):
        ok("network path reason cites shared network")
    else:
        fail("network path reasons", f"got {fe_net.reasons}")

    # ---------- impact of a leaf (postgres: who depends on it) -----------------
    pg_impact = predicted_impact(graph, "demo-postgres")
    assert_eq("postgres blast radius", sorted(p.impacted_service for p in pg_impact.impacted),
              ["demo-api", "demo-frontend", "demo-worker"])

    # ---------- impact of an isolated node ------------------------------------
    # frontend has no dependents → empty prediction, not an error
    fe_impact = predicted_impact(graph, "demo-frontend")
    assert_eq("frontend blast radius is empty (nothing depends on it)",
              fe_impact.impacted, [])

    # ---------- determinism: rebuild → identical edge/gap JSON -----------------
    graph2 = build_graph(parse_compose((FIXTURES / "demo-compose.yaml").read_text(encoding="utf-8")),
                         graph_id=UUID(int=0), name="demo")
    if graph.model_dump_json(exclude={"id"}) == graph2.model_dump_json(exclude={"id"}):
        ok("rebuild is deterministic (byte-identical minus id)")
    else:
        fail("determinism", "two builds of the same file differ")

    # ---------- env heuristics: what must NOT become an edge -------------------
    tricky = """
services:
  test:
    image: redis:7-alpine
  api:
    image: node:20
    environment:
      NODE_ENV: test          # key has no host hint → NO edge
      STRIPE_URL: https://api.stripe.com/v1   # host not a service → NO edge
      REDIS_HOST: test        # key hint + host is a service → edge
"""
    g = build_graph(parse_compose(tricky), name="tricky")
    tricky_pairs = {(e.source, e.target) for e in g.edges}
    assert_eq("env heuristic keeps only the real edge",
              tricky_pairs, {("api", "test")})
    # test classifies as cache (image) — not important here, but stable:
    tricky_kinds = {n.id: n.kind for n in g.nodes}
    assert_eq("service named 'test' with redis image is cache",
              tricky_kinds["test"], ServiceKind.CACHE)

    # ---------- summary --------------------------------------------------------
    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
