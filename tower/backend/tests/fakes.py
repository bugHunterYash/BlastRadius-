"""Test doubles that speak the real provider interfaces.

FakeClaudeClient has ClaudeSDKClient's interface and yields the SDK's own message classes, so the
adapter's parsing is exercised exactly as with a live CLI. The Codex double is a separate process
(fake_codex_app_server.py) speaking the app-server JSON-RPC protocol over stdio.
"""

import asyncio
import sys
from pathlib import Path

from claude_agent_sdk import (AssistantMessage, ResultMessage, StreamEvent, SystemMessage, TextBlock,
                              ThinkingBlock, ToolResultBlock, ToolUseBlock, UserMessage)

FAKE_CODEX = [sys.executable, str(Path(__file__).with_name("fake_codex_app_server.py"))]


def claude_script(prompt: str, session_id: str = "sess-claude-1") -> list:
    """A realistic Claude Code turn: init, streamed text, a Read and a Bash tool call, results, final answer."""
    return [
        SystemMessage(subtype="init", data={"session_id": session_id, "model": "claude-test", "tools": ["Read", "Bash"],
                                            "permissionMode": "default", "cwd": "/ws"}),
        StreamEvent(uuid="s1", session_id=session_id,
                    event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Let me read "}}),
        StreamEvent(uuid="s2", session_id=session_id,
                    event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": "the pricing sheet."}}),
        AssistantMessage(content=[ThinkingBlock(thinking="private reasoning", signature="sig"),
                                  TextBlock(text="Let me read the pricing sheet."),
                                  ToolUseBlock(id="tu1", name="Read", input={"file_path": "pricing.md"})],
                         model="claude-test", message_id="msg1"),
        UserMessage(content=[ToolResultBlock(tool_use_id="tu1", content="| Aqua bottle | ₹549 |", is_error=False)]),
        AssistantMessage(content=[ToolUseBlock(id="tu2", name="Bash",
                                               input={"command": "wc -l pricing.md", "description": "Count lines in the sheet"})],
                         model="claude-test", message_id="msg2"),
        UserMessage(content=[ToolResultBlock(tool_use_id="tu2", content=[{"type": "text", "text": "9 pricing.md"}],
                                             is_error=False)]),
        AssistantMessage(content=[TextBlock(text=f"Draft: launch at ₹499. (task: {prompt[:30]})")],
                         model="claude-test", message_id="msg3"),
        ResultMessage(subtype="success", duration_ms=1200, duration_api_ms=900, is_error=False, num_turns=3,
                      session_id=session_id, total_cost_usd=0.0123, result="Draft: launch at ₹499.",
                      usage={"input_tokens": 200, "output_tokens": 40}),
    ]


class FakeClaudeClient:
    """Same surface as ClaudeSDKClient: async context manager, query(), receive_response(), interrupt()."""

    instances: list["FakeClaudeClient"] = []

    def __init__(self, options, script=None, fail_with: Exception | None = None, hang: bool = False):
        self.options = options
        self.script = script
        self.fail_with = fail_with
        self.hang = hang
        self.prompt = None
        self.interrupted = asyncio.Event()
        FakeClaudeClient.instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def query(self, prompt):
        if self.fail_with:
            raise self.fail_with
        self.prompt = prompt

    async def interrupt(self):
        self.interrupted.set()

    async def receive_response(self):
        if self.hang:
            yield SystemMessage(subtype="init", data={"session_id": "sess-hang"})
            await self.interrupted.wait()
            yield ResultMessage(subtype="error_during_execution", duration_ms=1, duration_api_ms=1, is_error=True,
                                num_turns=1, session_id="sess-hang", errors=["interrupted"])
            return
        for m in self.script or claude_script(self.prompt):
            await asyncio.sleep(0)
            yield m
