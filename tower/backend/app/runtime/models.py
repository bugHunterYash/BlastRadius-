"""Provider-independent request, event and result models for agent runtimes."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

Provider = Literal["claude", "codex", "replay"]
RuntimeName = Literal["claude_agent_sdk", "codex_app_server", "replay"]
Status = Literal["queued", "running", "completed", "failed", "cancelled", "timeout"]

# Normalized event types. Adapters emit these; the API publishes them on SSE as "agent.<type>".
EVENT_TYPES = (
    "invocation.created", "invocation.started", "prompt.received", "session.started",
    "message.delta", "message.completed", "plan.updated",
    "tool.started", "tool.completed", "command.started", "command.output", "command.completed",
    "file.changed", "approval.requested", "approval.decided", "usage.updated",
    "execution.error", "invocation.completed", "invocation.failed", "invocation.cancelled",
)


class InvokeRequest(BaseModel):
    """Body of POST /v1/agents/{agent_id}/invoke."""

    run_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._:-]+$")
    prompt: str = Field(min_length=1, max_length=20_000)
    why: str | None = Field(default=None, max_length=500)
    workspace_id: str | None = Field(default=None, max_length=100)
    session_id: uuid.UUID | None = None          # continue an earlier session of this agent
    idempotency_key: str | None = Field(default=None, max_length=200)


class AgentRoute(BaseModel):
    """The complete routing decision for one invocation (stored on the invocation)."""

    agent_id: str
    provider: Provider
    runtime: RuntimeName
    model: str | None                             # None = the provider's own default
    workspace_id: str
    workspace_path: str
    system_prompt: str | None
    allowed_tools: list[str]
    permissions: dict[str, bool]                  # read / write / execute
    permission_mode: str
    sandbox: str
    max_turns: int
    timeout_s: float
    design_id: str | None = None


class RuntimeRequest(BaseModel):
    invocation_id: uuid.UUID
    run_id: str
    agent_id: str
    prompt: str
    why: str | None
    route: AgentRoute
    resume_provider_session_id: str | None = None  # Claude session id / Codex thread id


class RuntimeEvent(BaseModel):
    event_type: str
    why: str | None = None
    payload: dict[str, Any] = {}
    dedupe_key: str | None = None


class RuntimeResult(BaseModel):
    status: Status
    final_response: str | None = None
    provider_session_id: str | None = None
    provider_thread_id: str | None = None
    provider_turn_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    usage: dict[str, Any] | None = None
    error_message: str | None = None
    metadata: dict[str, Any] = {}


class ProviderHealth(BaseModel):
    provider: str
    enabled: bool
    available: bool
    detail: str
    version: str | None = None
    auth_mode: str | None = None
