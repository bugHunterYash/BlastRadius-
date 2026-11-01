"""Stands in for `agy -p ... --output-format stream-json` (Antigravity CLI 2.28): prints the same JSON lines.

Writes its argv to FAKE_AGY_LOG so tests can check the flags. FAKE_AGY_MODE=fail ends without an answer.
"""

import json
import os
import sys


def out(obj):
    print(json.dumps(obj), flush=True)


def main():
    if os.environ.get("FAKE_AGY_LOG"):
        with open(os.environ["FAKE_AGY_LOG"], "w", encoding="utf-8") as f:
            json.dump(sys.argv[1:], f)
    conv = "conv-test-1" if "--conversation" not in sys.argv else sys.argv[sys.argv.index("--conversation") + 1]
    step = lambda **s: out({"event": "step_update", "step_update": {"conversation_id": conv, **s}})
    out({"event": "init", "conversation_id": conv, "init": {"model": "gemini-test", "cwd": os.getcwd(),
                                                             "tools": ["read_file"], "permission_mode": "request-review"}})
    step(step_index=0, state="DONE", step_type="user_input")
    step(step_index=1, state="ACTIVE", step_type="agent_response", text_delta="Reading the pricing ")
    step(step_index=1, state="DONE", step_type="agent_response", text_delta="file.", usage={"input_tokens": 50, "output_tokens": 5})
    tool = {"name": "read_file", "parameters": {"Path": os.path.join(os.getcwd(), "pricing.md")}}
    step(step_index=2, state="ACTIVE", step_type="tool", tool_name="read_file", tool_info=tool)
    step(step_index=2, state="DONE", step_type="tool", tool_name="read_file", tool_info={**tool, "output": "12 lines"})
    if os.environ.get("FAKE_AGY_MODE") == "fail":
        cmd = {"name": "run_command", "parameters": {"CommandLine": "rm -rf build"}}
        step(step_index=3, state="ACTIVE", step_type="tool", tool_name="run_command", tool_info=cmd)
        step(step_index=3, state="ERROR", step_type="tool", tool_name="run_command",
             tool_info={**cmd, "error": {"type": "TOOL_ERROR", "message": "user denied permission"}})
        out({"event": "result", "result": {"conversation_id": conv, "status": "SUCCESS", "response": "",
                                           "denied_actions": [{"action": "command", "display_name": "RunCommand"}]}})
        print("jetski: no output produced", file=sys.stderr)
        return
    step(step_index=3, state="DONE", step_type="agent_response", text_delta="The price is Rs. 549.")
    out({"event": "result", "result": {"conversation_id": conv, "status": "SUCCESS", "response": "The price is Rs. 549.\n",
                                       "duration_seconds": 1.5, "num_turns": 1,
                                       "usage": {"input_tokens": 120, "output_tokens": 12}}})


if __name__ == "__main__":
    main()
