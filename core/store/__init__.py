# =============================================================================
# core.store — persistence interfaces (SQLite now, Postgres later)
# =============================================================================
# The backend and CLI both code against Store's method names; engine choice
# is a constructor argument away. See sqlite_store.py header for the JSON-vs-
# columns rationale and the config-immutability trigger.
# =============================================================================

from core.store.sqlite_store import (
    ConfigImmutable,
    ExperimentRecord,
    NotFound,
    Store,
    StoreError,
)

__all__ = [
    "ConfigImmutable",
    "ExperimentRecord",
    "NotFound",
    "Store",
    "StoreError",
]
