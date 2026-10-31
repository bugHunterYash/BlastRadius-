# =============================================================================
# core.safety — allowlists and hard-cap re-checks (layer 1 + 2)
# =============================================================================
# WHAT LIVES HERE vs where:
#   allowlists.py  load/fault TARGET validation (pure; DNS injected for tests)
#   limits.py      cap re-checks (layer 2 of 3: Pydantic → HERE → k6 options)
#
# WHAT DOES NOT LIVE HERE:
#   preflight.py (the 9 Docker-dependent checks) — needs the Docker SDK and
#   a live daemon; added in a later step when integration testing begins.
#   Everything in this package is pure logic: unit-testable with zero infra.
# =============================================================================

from core.safety.allowlists import CheckResult, check_load_target, host_matches, is_safe_ip
from core.safety.limits import Caps, check_load_against_caps, effective_caps
from core.safety.preflight import run_preflight

__all__ = [
    "CheckResult",
    "check_load_target",
    "host_matches",
    "is_safe_ip",
    "Caps",
    "check_load_against_caps",
    "effective_caps",
    "run_preflight",
]
