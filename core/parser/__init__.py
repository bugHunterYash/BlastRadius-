# =============================================================================
# core.parser package — public surface
# =============================================================================
# Callers import from `core.parser` (not core.parser.compose) so the internal
# module layout can change without touching the API/CLI layers.
# =============================================================================

from core.parser.compose import ComposeParseError, parse_compose

__all__ = ["parse_compose", "ComposeParseError"]
