# =============================================================================
# core.load — k6 script generation (C1) and subprocess management (C2)
# =============================================================================
# C1 (script.py) is pure: unit-tested without a k6 binary installed.
# C2 (runner.py, next step) spawns the subprocess and streams JSON samples —
# integration-tested with the real k6 + demo app.
# =============================================================================

from core.load.script import RenderedScript, build_stages, estimate_requests, generate_k6_script

__all__ = [
    "RenderedScript",
    "build_stages",
    "estimate_requests",
    "generate_k6_script",
]
