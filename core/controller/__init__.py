# =============================================================================
# core.controller — experiment state machine, schedule & execution
# =============================================================================

from core.controller.experiment import ExperimentController
from core.controller.schedule import PhaseSchedule, PhaseSegment

__all__ = [
    "ExperimentController",
    "PhaseSchedule",
    "PhaseSegment",
]
