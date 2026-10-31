# =============================================================================
# Parser tests — run: python tests/test_parser.py
# =============================================================================
# Covers the spec's validation-error table (§6.2) — every message is asserted
# verbatim because these strings are a UI contract (shown inline in the YAML
# editor). If you change a message, the frontend gutter mapping changes too.
# =============================================================================

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Windows consoles default to cp1252, which crashes on unicode (→, ✓) in test
# names. Force UTF-8 so output is identical across platforms/CI.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from core.parser import ComposeParseError, parse_compose

FIXTURES = Path(__file__).resolve().parent / "fixtures"

PASS = 0
FAIL = 0


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"  PASS  {name}")


def expect_error(name: str, raw: str, contains: str, *, line: int | None = None) -> None:
    """Assert parse fails AND the message contains `contains` (verbatim
    substring — the UI contract). Optionally assert a line number, which the
    YAML editor uses for the gutter."""
    global PASS, FAIL
    try:
        parse_compose(raw)
    except ComposeParseError as e:
        if contains in e.message and (line is None or e.line == line):
            PASS += 1
            print(f"  PASS  {name}")
            print(f"        -> {e.message[:90]}")
        else:
            FAIL += 1
            print(f"  FAIL  {name}")
            print(f"        expected to contain: {contains!r}")
            print(f"        got: {e.message!r} (line={e.line})")
    except Exception as e:  # noqa: BLE001 — wrong exception type is a failure
        FAIL += 1
        print(f"  FAIL  {name}: wrong exception type {type(e).__name__}: {e}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}: expected ComposeParseError, parse succeeded")


def main() -> int:
    # ---------- valid demo fixture ----------
    model = parse_compose((FIXTURES / "demo-compose.yaml").read_text(encoding="utf-8"),
                          filename="demo-compose.yaml")
    assert len(model.services) == 5, f"expected 5 services, got {len(model.services)}"
    ok("demo fixture parses: 5 services")

    api = model.services["demo-api"]
    assert [d.service for d in api.depends_on] == ["demo-redis", "demo-postgres"]
    assert all(d.condition == "service_healthy" for d in api.depends_on)
    ok("long-form depends_on normalized with conditions")

    fe = model.services["demo-frontend"]
    assert [d.service for d in fe.depends_on] == ["demo-api"] and fe.depends_on[0].condition == "service_started"
    ok("short-form depends_on normalized (default condition)")

    assert api.labels["blastradius.fault-allowed"] == "true"
    assert api.environment["REDIS_URL"] == "redis://demo-redis:6379"
    ok("labels + environment parsed (fault-allowed, REDIS_URL)")

    # volumes is unsupported → must be preserved as unanalysed, never dropped
    pg = model.services["demo-postgres"]
    assert "volumes" in pg.unanalysed_keys
    assert any("not analysed" in w for w in model.warnings)
    ok("unsupported key 'volumes' preserved as unanalysed + warning")

    # worker must have NO declared deps — the graph tests will infer them
    assert model.services["demo-worker"].depends_on == []
    ok("demo-worker has no declared deps (inference demo preserved)")

    assert model.name == "blastradius-demo"
    ok("top-level name parsed")

    # ---------- spec error table (§6.2) ----------
    expect_error(
        "invalid YAML → line/column position",
        "services:\n  a:\n    image: x\n   bad_indent: y\n",
        "Line ",
        line=4,
    )

    expect_error(
        "no services key",
        "version: '3'\nnetworks: {}\n",
        "No 'services' section found",
    )

    expect_error(
        "unknown dependency",
        "services:\n  api:\n    image: x\n    depends_on: [cache]\n",
        "Service 'api' depends on 'cache', which is not defined in services.",
    )

    expect_error(
        "dependency cycle",
        "services:\n  api:\n    image: x\n    depends_on: [worker]\n"
        "  worker:\n    image: x\n    depends_on: [api]\n",
        "Dependency cycle detected:",
    )

    expect_error(
        "oversize file",
        "# " + "x" * (300 * 1024),
        "maximum supported size is 256 KB",
    )

    expect_error(
        "invalid port spec",
        "services:\n  web:\n    image: x\n    ports: ['80:abc']\n",
        "Service 'web': port '80:abc' is not a valid port mapping.",
    )

    # ---------- guards beyond the spec table ----------
    expect_error(
        "empty file",
        "",
        "File is empty.",
    )

    expect_error(
        "top-level list, not map",
        "- a\n- b\n",
        "Expected a YAML mapping",
    )

    expect_error(
        "service body not a map",
        "services:\n  api: just-a-string\n",
        "Service 'api' must be a map",
    )

    expect_error(
        "links to unknown service",
        "services:\n  api:\n    image: x\n    links: [db:database]\n",
        "Service 'api' links to 'db', which is not defined in services.",
    )

    expect_error(
        "unsupported depends_on condition",
        "services:\n  a:\n    image: x\n  b:\n    image: x\n"
        "    depends_on:\n      a: { condition: service_magic }\n",
        "condition 'service_magic' is not supported",
    )

    expect_error(
        "too many services",
        "services:\n" + "".join(f"  s{i}: {{ image: x }}\n" for i in range(51)),
        "maximum supported is 50",
    )

    # ---------- alias bomb guard ----------
    # 300 aliases of one anchored scalar — over MAX_ALIASES (100).
    anchor_yaml = "services:\n  a: &x \"y\"\n" + "".join(f"  s{i}: *x\n" for i in range(150))
    expect_error(
        "alias bomb rejected",
        anchor_yaml,
        "aliases (limit 100)",
    )

    # ---------- success cases for boundary sizes ----------
    parse_compose("services:\n  a: { image: x }\n")
    ok("minimal valid compose")

    parse_compose("services:\n  a: { image: x, environment: [K=V, BARE] }\n")
    ok("env list form accepted at parse level")

    # ---------- summary ----------
    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
