# =============================================================================
# Safety (pure-logic part) tests — run: python tests/test_safety.py
# =============================================================================
# Covers allowlists (host matching, safe IPs, target checks with fake DNS)
# and the layer-2 cap re-check — including the load-bearing case:
#   a LoadConfig built with model_construct (validation BYPASSED) must still
#   be rejected by check_load_against_caps. If this test ever fails, layer 2
#   has rotted and the three-layer safety story is a two-layer story.
# =============================================================================

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from core.safety import (
    Caps,
    CheckResult,
    check_load_against_caps,
    check_load_target,
    effective_caps,
    host_matches,
    is_safe_ip,
)
from core.safety.limits import check_endpoints_against_allowlist
from core.schemas.experiment import LoadConfig

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


def assert_true(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        ok(name)
    else:
        fail(name, detail or "condition was false")


def fake_resolver(mapping: dict[str, list[str]], counter: list[str] | None = None):
    def _r(host: str) -> list[str]:
        if counter is not None:
            counter.append(host)
        return mapping.get(host, [])
    return _r


def main() -> int:
    # ---------- host_matches ----------
    assert_true("exact match", host_matches("demo-api", ["demo-api", "localhost"]))
    assert_true("case-insensitive match", host_matches("DEMO-API", ["demo-api"]))
    assert_true("wildcard suffix match", host_matches("api.test", ["*.test"]))
    assert_true("wildcard apex match (bare 'test')", host_matches("test", ["*.test"]))
    assert_true("exact beats nothing: no match → False", not host_matches("evil.com", ["demo-api", "*.test"]))
    assert_true("prefix-glob NOT supported (demolition vs demo*)",
                not host_matches("demolition.io", ["demo*"]), "prefix globs must not match")
    assert_true("wildcard does not match superstring of suffix (notatest)",
                not host_matches("notatest", ["*.test"]))
    assert_true("empty pattern list → False", not host_matches("localhost", []))

    # ---------- is_safe_ip ----------
    for ip in ("127.0.0.1", "::1", "10.1.2.3", "172.17.0.2", "192.168.1.50",
               "172.31.255.1", "fc00::1", "fd12:3456::1"):
        assert_true(f"safe: {ip}", is_safe_ip(ip), "expected safe")
    for ip in ("8.8.8.8", "1.1.1.1", "93.184.216.34", "2001:4860:4860::8888"):
        assert_true(f"unsafe: {ip}", not is_safe_ip(ip), "expected unsafe")
    assert_true("metadata service rejected: 169.254.169.254",
                not is_safe_ip("169.254.169.254"), "SSRF classic must be blocked")
    assert_true("garbage IP fails closed", not is_safe_ip("not-an-ip"))
    assert_true("empty string fails closed", not is_safe_ip(""))

    # ---------- check_load_target (fake DNS) ----------
    allow = ["localhost", "127.0.0.1", "demo-api", "*.test"]

    r = check_load_target("http://demo-api:3000", allow,
                          resolver=fake_resolver({"demo-api": ["172.18.0.5"]}))
    assert_true("allowlisted + private IP → pass", r.ok, r.reason)
    assert_true("resolved_ip recorded for preflight display",
                r.resolved_ip == "172.18.0.5", f"got {r.resolved_ip}")

    r = check_load_target("http://api.test", allow,
                          resolver=fake_resolver({"api.test": ["10.0.0.9"]}))
    assert_true("wildcard-allowlisted host passes", r.ok, r.reason)

    r = check_load_target("http://victim.example.com", allow,
                          resolver=fake_resolver({"victim.example.com": ["93.184.216.34"]}))
    assert_true("non-allowlisted host rejected", not r.ok)
    assert_true("rejection message names the host + allowlist",
                "victim.example.com" in r.reason and "LOAD_TARGET_ALLOWLIST" in r.reason,
                f"got {r.reason}")

    # policy rejects BEFORE paying DNS (counter stays empty)
    calls: list[str] = []
    r = check_load_target("http://evil.com", allow, resolver=fake_resolver({}, calls))
    assert_true("policy check runs before DNS (no resolver call)",
                not r.ok and calls == [], f"ok={r.ok}, calls={calls}")

    # allowlisted but DNS says PUBLIC → reject (the answer, not the label)
    r = check_load_target("http://sneaky.test", allow,
                          resolver=fake_resolver({"sneaky.test": ["34.200.10.10"]}))
    assert_true("allowlisted host resolving PUBLIC → rejected",
                not r.ok and "not a loopback/private" in r.reason, f"got {r.reason}")

    # allowlisted but unresolvable → distinct typo-style message
    r = check_load_target("http://ghost.test", allow, resolver=fake_resolver({}))
    assert_true("allowlisted but unresolvable → rejected",
                not r.ok and "did not resolve" in r.reason, f"got {r.reason}")

    # scheme gate
    r = check_load_target("ftp://localhost", allow, resolver=fake_resolver({}))
    assert_true("non-http scheme rejected", not r.ok and "scheme" in r.reason, f"got {r.reason}")

    # ---------- effective_caps: env may TIGHTEN, never LOOSEN ----------
    ec = effective_caps()
    assert_true("no env → ceilings apply",
                ec.caps.max_rps == 500 and ec.violations == [])

    ec = effective_caps(max_rps=100)
    assert_true("env tighter than ceiling is honored (100 kept)",
                ec.caps.max_rps == 100 and ec.violations == [])

    ec = effective_caps(max_rps=5000)
    assert_true("env LOOSER than ceiling is clamped",
                ec.caps.max_rps == 500, f"got {ec.caps.max_rps}")
    assert_true("loosening attempt recorded as violation",
                len(ec.violations) == 1 and "5000" in ec.violations[0],
                f"got {ec.violations}")

    # ---------- layer-2 cap checks ----------
    caps = Caps()  # schema ceilings

    good = LoadConfig(target_base_url="http://demo-api:3000", endpoints=["/health"],
                      baseline_rps=20, multipliers=[1, 2, 5, 10])
    assert_true("compliant config → zero violations",
                check_load_against_caps(good, caps) == [],
                str(check_load_against_caps(good, caps)))

    strict = Caps(max_rps=100, max_vus=50, max_duration_s=60,
                  max_total_requests=10_000, max_timeout_s=5.0)
    viols = check_load_against_caps(good, strict)
    # good peaks at 200 RPS, 100s, 20k est. requests → 4 violations expected
    assert_true("strict server caps flag RPS + duration + requests",
                len(viols) >= 3, f"got {viols}")

    # THE load-bearing test: bypass layer 1 entirely
    smuggled = LoadConfig.model_construct(
        target_base_url="http://x", endpoints=["/a"],
        baseline_rps=500, multipliers=[10.0], max_vus=200,
        request_timeout_s=10.0, step_duration_s=120, ramp_s=30,
    )
    viols = check_load_against_caps(smuggled, Caps())
    assert_true("model_construct bypass is caught by layer 2 (peak 5000 > 500)",
                any("peak RPS" in v for v in viols), f"got {viols}")
    # multipliers=[10.0] alone: duration = 1*(120+30)=150s ≤ 300 ok,
    # estimated = 150 * 10 * 500 = 750k > 100k → also flagged:
    assert_true("request-cap estimate also flagged on smuggled config",
                any("total requests" in v for v in viols), f"got {viols}")

    # endpoint path allowlist
    assert_true("empty allowlist = no path violations",
                check_endpoints_against_allowlist(["/anything"], []) == [])
    pviols = check_endpoints_against_allowlist(["/admin"], ["/health", "/api/products"])
    assert_true("path outside declared list flagged",
                len(pviols) == 1 and "/admin" in pviols[0], f"got {pviols}")

    # ---------- summary --------------------------------------------------------
    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
