"""Four rule-based detectors. No LLM, so every result is reproducible and unit-testable."""

from app.detectors.base import IssueDraft
from app.detectors.conflict import conflict
from app.detectors.handoff import skipped_handoff
from app.detectors.permission import permission_leak
from app.detectors.stale_read import stale_read

DETECTORS = [stale_read, conflict, skipped_handoff, permission_leak]

__all__ = ["DETECTORS", "IssueDraft", "conflict", "permission_leak", "skipped_handoff", "stale_read"]
