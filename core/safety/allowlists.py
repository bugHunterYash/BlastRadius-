# =============================================================================
# core.safety.allowlists — "may we send load to this target?"
# =============================================================================
# WHY this is a separate layer from the LoadConfig schema validators:
#   Pydantic validates SHAPE (paths, caps, ascending multipliers). This module
#   validates the WORLD (does this host resolve to something we're allowed to
#   hit?). Shape is known at config time; world checks need DNS — a different
#   moment, different failure modes, different messages (preflight check #5).
#
# The safety chain for a load target, in order:
#   1. schema: endpoint must be a PATH (no scheme smuggling)
#   2. HERE:   hostname ∈ LOAD_TARGET_ALLOWLIST (exact or *.suffix wildcard)
#   3. HERE:   resolved IP is loopback/private/RFC1918 — DNS could point
#              "localhost.evil.com" anywhere; we check the ANSWER, not the name
#   4. runner: GET only, follow_redirects=False (a 302 to a public host must
#              not be followed — enforced where the request is made)
#
# WHY the resolver is injectable: unit tests must not do real DNS (flaky in
# CI, slow, untestable for failure paths). Production passes
# socket.getaddrinfo; tests pass a dict-backed fake.
# =============================================================================

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from urllib.parse import urlsplit

# resolver signature: hostname → list of IP strings (empty = NXDOMAIN/failure)
Resolver = Callable[[str], list[str]]


@dataclass(frozen=True)
class CheckResult:
    """Outcome of one allowlist check. `reason` is user-facing (preflight
    renders it verbatim next to the failed check) and must explain WHAT to do,
    not just what failed: 'host not in allowlist' → user adds it to .env."""

    ok: bool
    reason: str
    resolved_ip: str | None = None

    @classmethod
    def passed(cls, reason: str, ip: str | None = None) -> CheckResult:
        return cls(ok=True, reason=reason, resolved_ip=ip)

    @classmethod
    def failed(cls, reason: str) -> CheckResult:
        return cls(ok=False, reason=reason, resolved_ip=None)


def default_resolver(host: str) -> list[str]:
    """Production DNS lookup. getaddrinfo returns (family, type, proto,
    canonname, sockaddr) tuples; we extract sockaddr[0] and dedupe, keeping
    IPv4 first so the reported IP in preflight is the familiar form."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return []
    v4: list[str] = []
    v6: list[str] = []
    for info in infos:
        ip = info[4][0]
        (v4 if ":" not in ip else v6).append(ip)
    # dedupe preserving order
    seen: set[str] = set()
    ordered = [ip for ip in (v4 + v6) if not (ip in seen or seen.add(ip))]
    return ordered


def host_matches(host: str, patterns: Sequence[str]) -> bool:
    """Allowlist matching: exact (case-insensitive) or wildcard suffix.

        'demo-api' matches 'demo-api'
        'api.test'  matches '*.test'

    WHY wildcards: demo/staging subdomains rotate (api-1.test) while the
    policy stays 'anything under .test is safe'. Leading '*.' only — '*.test'
    not 'demo*' (prefix globs would let 'demoevil.com'... actually prefix
    globs are the classic mistake: never match 'demo*' against 'demolition.io').
    """
    h = host.lower().rstrip(".")
    for pat in patterns:
        p = pat.strip().lower()
        if not p:
            continue
        if p.startswith("*."):
            suffix = p[1:]              # '*.test' → '.test'
            if h.endswith(suffix) and len(h) > len(suffix):
                return True
            # allow the apex itself too: '.test' bare host equal to pattern's base
            if h == p[2:]:
                return True
        elif h == p:
            return True
    return False


def is_safe_ip(ip: str) -> bool:
    """Is this address something we're willing to hammer?

    ALLOWED: loopback (127/8, ::1) + private/RFC1918 (10/8, 172.16/12, 192.168/16)
    + IPv6 unique-local (fc00::/7). Docker bridge networks (172.17/16) are
    inside 172.16/12, so containers on the default bridge are covered.

    REJECTED: every public address — this is the load-target version of
    'never test a site you don't own'. Link-local (169.254/16) is rejected
    too: 169.254.169.254 is the cloud metadata service, the classic SSRF
    target, and there is no legitimate load-test reason to hit it.

    Parse failures (garbage strings) → False: fail closed, never open.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.is_loopback:
        return True
    if addr.is_link_local:      # checked BEFORE private: 169.254/16 is not
        return False            # is_private in modern Python, but be explicit
    if isinstance(addr, ipaddress.IPv6Address):
        return addr.is_private  # covers fc00::/7 unique-local
    return addr.is_private      # IPv4 RFC1918


def check_load_target(
    base_url: str,
    allowlist: Sequence[str],
    *,
    resolver: Resolver = default_resolver,
) -> CheckResult:
    """Preflight check #5: allowlisted hostname AND safe resolved IP.

    Order matters for message quality: if the HOST is not even allowlisted we
    say so first (actionable: edit the env var). Only if it passes do we pay
    a DNS lookup — an early exit keeps preflight fast for obvious rejects.
    """
    try:
        parts = urlsplit(base_url)
    except ValueError as e:
        return CheckResult.failed(f"target URL is not parseable: {e}")

    if parts.scheme not in ("http", "https"):
        return CheckResult.failed(
            f"target URL scheme '{parts.scheme}' is not allowed (http/https only)."
        )
    host = parts.hostname
    if not host:
        return CheckResult.failed("target URL has no hostname.")

    if not host_matches(host, allowlist):
        allowed = ", ".join(allowlist) or "(empty)"
        return CheckResult.failed(
            f"target host '{host}' is not in LOAD_TARGET_ALLOWLIST "
            f"(allowed: {allowed})."
        )

    # Hostname passed the policy — now verify where DNS points. A hostname is
    # just a label; the ANSWER is what gets hammered.
    ips = resolver(host)
    if not ips:
        # Allowlisted but unresolvable: fail (can't send load to nothing),
        # but with a distinct message — this is a typo/DNS problem, not policy.
        return CheckResult.failed(
            f"target host '{host}' did not resolve to any address."
        )

    safe_ips = [ip for ip in ips if is_safe_ip(ip)]
    if not safe_ips:
        return CheckResult.failed(
            f"target host '{host}' resolves to {', '.join(ips[:3])}, which is "
            f"not a loopback/private address. BlastRadius only loads "
            f"localhost, RFC1918, or Docker-network targets."
        )

    return CheckResult.passed(
        f"target '{host}' allowlisted, resolved to {safe_ips[0]} (private/loopback).",
        ip=safe_ips[0],
    )
