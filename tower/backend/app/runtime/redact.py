"""Secret redaction and size limits for everything captured from a runtime before it is stored."""

import os
import re
from typing import Any

MAX_TEXT = 8_000          # per string inside an event payload
MAX_PROMPT = 20_000       # prompts and final responses

_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{10,}"),
    re.compile(r"sk-(?:proj-)?[A-Za-z0-9_\-]{20,}"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{16,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"(?i)(password|passwd|secret|api[_-]?key|token)(\s*[=:]\s*)(['\"]?)[^\s'\"]{6,}"),
]
_SECRET_ENV = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "MEKO_API_KEY",
               "TOWER_INGEST_TOKEN", "TOWER_API_TOKEN", "DATABASE_URL")


def _env_secrets() -> list[str]:
    return [v for k in _SECRET_ENV if (v := os.environ.get(k)) and len(v) >= 8]


def redact_text(text: str, limit: int = MAX_TEXT) -> str:
    for secret in _env_secrets():
        text = text.replace(secret, "[REDACTED]")
    for p in _PATTERNS:
        text = p.sub(lambda m: m.group(1) + m.group(2) + "[REDACTED]" if m.re.groups >= 3 else "[REDACTED]", text)
    if len(text) > limit:
        text = text[:limit] + f"... [truncated {len(text) - limit} chars]"
    return text


def redact(value: Any, limit: int = MAX_TEXT, _depth: int = 0) -> Any:
    """Recursively redact strings in a JSON-like value."""
    if _depth > 8:
        return "[nested too deep]"
    if isinstance(value, str):
        return redact_text(value, limit)
    if isinstance(value, dict):
        return {str(k): redact(v, limit, _depth + 1) for k, v in list(value.items())[:200]}
    if isinstance(value, (list, tuple)):
        return [redact(v, limit, _depth + 1) for v in list(value)[:200]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact_text(str(value), limit)
