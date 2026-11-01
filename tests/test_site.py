# =============================================================================
# Site API tests — run: python tests/test_site.py   (or pytest)
# =============================================================================
# Landing page endpoints: waitlist signup is idempotent per email (case and
# whitespace normalised), bad input is a 422, and stats come from the store.
# =============================================================================

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.state import AppState
from core.store import Store

PASS = 0
FAIL = 0


def assert_true(cond: bool, name: str) -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}")


def make_client() -> TestClient:
    return TestClient(create_app(AppState(store=Store(":memory:"))))


def main() -> int:
    c = make_client()

    r = c.get("/api/site/stats")
    assert_true(r.status_code == 200, "stats 200")
    assert_true(r.json() == {"waitlist": 0, "experiments": 0, "reports": 0}, "stats start at zero")

    r = c.post("/api/site/waitlist", json={"email": "riya@example.com", "plan": "pro"})
    assert_true(r.status_code == 201, "first join is 201")
    assert_true(r.json() == {"status": "joined", "position": 1}, "first join position 1")

    r = c.post("/api/site/waitlist", json={"email": "karan@example.com", "plan": "team"})
    assert_true(r.json()["position"] == 2, "second join position 2")

    r = c.post("/api/site/waitlist", json={"email": "  RIYA@example.com ", "plan": "team"})
    assert_true(r.status_code == 200, "repeat join is 200")
    assert_true(r.json() == {"status": "already_joined", "position": 1}, "repeat keeps position")

    r = c.post("/api/site/waitlist", json={"email": "not-an-email"})
    assert_true(r.status_code == 422, "bad email is 422")

    r = c.post("/api/site/waitlist", json={"email": "a@b.co", "plan": "platinum"})
    assert_true(r.status_code == 422, "unknown plan is 422")

    r = c.get("/api/site/stats")
    assert_true(r.json()["waitlist"] == 2, "stats counts unique emails")

    r = c.options(
        "/api/site/waitlist",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert_true(
        r.headers.get("access-control-allow-origin") == "http://localhost:5173",
        "CORS allows the Vite dev origin",
    )

    print(f"\n{PASS} passed, {FAIL} failed")
    return 0 if FAIL == 0 else 1


def test_all() -> None:
    assert main() == 0


if __name__ == "__main__":
    raise SystemExit(main())
