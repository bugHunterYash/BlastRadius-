"""Stands in for the Claude Code CLI's `auth` commands in tests.

  auth status            -> JSON like the real CLI ({"loggedIn": ..., "authMethod": ...})
  auth login --claudeai  -> prints a sign-in URL, "completes" the login, exits 0
State lives in the file named by FAKE_CLAUDE_STATE.
"""

import json
import os
import sys
import time

state_file = os.environ["FAKE_CLAUDE_STATE"]


def logged_in() -> bool:
    return os.path.exists(state_file)


args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    print(json.dumps({"loggedIn": logged_in(), "authMethod": "claude.ai" if logged_in() else "none",
                      "email": "someone@example.com" if logged_in() else None, "subscriptionType": "pro"}))
elif args[:2] == ["auth", "login"]:
    print("Opening browser to sign in...", flush=True)
    print("If the browser didn't open, visit: https://claude.ai/oauth/authorize?code=true&client_id=test", flush=True)
    time.sleep(0.5)
    if os.environ.get("FAKE_CLAUDE_FAIL"):
        print("Login failed: access denied", flush=True)
        sys.exit(1)
    open(state_file, "w").close()
    print("Login successful.", flush=True)
else:
    sys.exit(2)
