"""Import Claude Code sessions that already ran on this machine (desktop app, CLI, IDE) into the tower.

Claude Code keeps every session as a local JSONL transcript (~/.claude/projects/...). The official
claude-agent-sdk reads them (list_sessions / get_session_messages); we normalize the messages into
the same execution events as live invocations, so one inspector shows both.

Read-only: nothing is sent anywhere and the transcript is not modified. Imported invocations are
labelled runtime="claude_code_import" so they're never confused with runs the tower launched.
Thinking blocks are dropped; everything else is redacted and size-capped like live captures.
claude.ai web chats are not on disk and can't be imported.
"""

import asyncio
import datetime as dt
from typing import Any

from app import execution_db as xdb
from app.runtime.redact import MAX_PROMPT, redact, redact_text

RUNTIME = "claude_code_import"
FILE_WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def _ms(v) -> str | None:
    try:
        return dt.datetime.fromtimestamp(int(v) / 1000, dt.timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _info(s) -> dict:
    return {"session_id": s.session_id, "title": s.custom_title or s.summary, "first_prompt": (s.first_prompt or "")[:200],
            "cwd": s.cwd, "git_branch": s.git_branch, "size_bytes": s.file_size,
            "created_at": _ms(s.created_at), "last_modified": _ms(s.last_modified)}


async def list_local(limit: int = 50, directory: str | None = None) -> list[dict]:
    from claude_agent_sdk import list_sessions
    sessions = await asyncio.to_thread(list_sessions, directory, limit)
    return [_info(s) for s in sessions]


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""


def normalize(messages: list) -> tuple[list[tuple[str, str | None, dict]], dict]:
    """SessionMessages -> (events, summary). Same event types and `why` rules as the live adapter."""
    events: list[tuple[str, str | None, dict]] = []
    tools: dict[str, tuple[str, dict]] = {}
    first_prompt, last_text, model = None, None, None
    usage = {"input_tokens": 0, "output_tokens": 0}
    for m in messages:
        msg = m.message if isinstance(m.message, dict) else {}
        content = msg.get("content")
        if m.type == "user":
            if isinstance(content, str) or any(isinstance(b, dict) and b.get("type") == "text" for b in content or []):
                text = _text(content)
                if text.strip():
                    first_prompt = first_prompt or text
                    events.append(("prompt.received", None, {"prompt": text, "uuid": m.uuid}))
            for b in content if isinstance(content, list) else []:
                if not isinstance(b, dict) or b.get("type") != "tool_result":
                    continue
                name, tool_input = tools.get(b.get("tool_use_id"), (None, {}))
                out = b.get("content")
                out = out if isinstance(out, str) else _text(out)
                failed = bool(b.get("is_error"))
                events.append(("tool.completed", None, {"tool_use_id": b.get("tool_use_id"), "tool": name,
                                                         "is_error": failed, "output": out}))
                if name == "Bash":
                    events.append(("command.completed", None, {"command": tool_input.get("command"),
                                                                "is_error": failed, "output": out}))
                if name in FILE_WRITE_TOOLS and not failed:
                    events.append(("file.changed", None, {"tool": name, "path": tool_input.get("file_path")
                                                          or tool_input.get("notebook_path")}))
        elif m.type == "assistant":
            model = msg.get("model") or model
            for k in usage:
                usage[k] += int((msg.get("usage") or {}).get(k) or 0)
            for b in content if isinstance(content, list) else []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and b.get("text", "").strip():
                    last_text = b["text"]
                    events.append(("message.completed", None, {"text": b["text"], "model": msg.get("model")}))
                elif b.get("type") == "tool_use":
                    tool_input = b.get("input") or {}
                    tools[b.get("id")] = (b.get("name"), tool_input)
                    if isinstance(tool_input.get("description"), str):
                        why, source = tool_input["description"], "tool_input.description"
                    elif last_text:
                        why, source = last_text[:300], "preceding_assistant_text"
                    else:
                        why, source = None, None
                    events.append(("tool.started", why, {"tool_use_id": b.get("id"), "tool": b.get("name"),
                                                         "input": tool_input, "why_source": source}))
                    if b.get("name") == "Bash":
                        events.append(("command.started", why, {"command": tool_input.get("command")}))
                # "thinking" blocks are never stored
    return events, {"first_prompt": first_prompt, "final_response": last_text, "model": model, "usage": usage}


async def import_session(session_id: str, run_id: str | None = None, agent_id: str = "claude-code",
                         directory: str | None = None, max_messages: int = 5000) -> tuple[dict, bool]:
    """Import one local session as an invocation. Idempotent: importing the same session again
    returns the earlier import."""
    from claude_agent_sdk import get_session_info, get_session_messages

    info = await asyncio.to_thread(get_session_info, session_id, directory)
    if info is None:
        raise LookupError(f"no local Claude Code session {session_id}")
    messages = await asyncio.to_thread(get_session_messages, session_id, directory, max_messages)
    events, summary = normalize(messages)

    inv, created = await xdb.create_invocation(
        run_id=run_id or f"claude-session-{session_id[:8]}", agent_id=agent_id, provider="claude", runtime=RUNTIME,
        model=summary["model"], workspace_id="imported", why=None, system_prompt=None,
        user_prompt=redact_text(summary["first_prompt"] or "(no text prompt)", MAX_PROMPT),
        routing={"source": "local Claude Code transcript", "launched_by_tower": False},
        session_id=None, idempotency_key=f"import:claude:{session_id}",
    )
    if not created:
        return inv, False
    stored = await xdb.append_events_bulk(
        inv["invocation_id"],
        [("session.started", None, {"session_id": session_id, "model": summary["model"], "imported": True})]
        + [(t, redact_text(w, 500) if w else None, redact(p)) for t, w, p in events],
    )
    sid = await xdb.upsert_session(run_id=inv["run_id"], agent_id=agent_id, provider="claude",
                                   provider_session_id=session_id, workspace_id="imported", status="imported")
    final = await xdb.finalize(
        inv["invocation_id"], status="completed",
        final_response=redact_text(summary["final_response"], MAX_PROMPT) if summary["final_response"] else None,
        error_message=None, provider_thread_id=session_id, provider_turn_id=None,
        input_tokens=summary["usage"]["input_tokens"], output_tokens=summary["usage"]["output_tokens"],
        usage=summary["usage"], session_id=sid,
        metadata=redact({**_info(info), "imported": True, "messages": len(messages), "events": stored,
                         "truncated": len(messages) >= max_messages}),
    )
    return final, True
