"""Pydantic schemas for request bodies, plus the event row the detectors read."""

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Op = Literal["run_start", "run_end", "read", "write", "handoff"]


class EventIn(BaseModel):
    event_id: uuid.UUID
    run_id: str = Field(min_length=1, max_length=200)
    agent: str = Field(min_length=1, max_length=100)
    op: Op
    fact_key: str | None = Field(default=None, max_length=200)
    version: int | None = Field(default=None, ge=1)
    value_preview: str | None = None
    target_agent: str | None = Field(default=None, max_length=100)
    reason: str | None = None   # why the agent did this, in its own words
    invocation_id: uuid.UUID | None = None  # set when the memory call happened inside an agent invocation
    ts: dt.datetime
    # Only read on run_start: which Datapack and which repeatable scenario this run belongs to.
    datapack: str | None = None
    scenario: str | None = None

    @field_validator("value_preview", "reason")
    @classmethod
    def _cap_text(cls, v: str | None) -> str | None:
        return v[:200] if v is not None else None

    @field_validator("ts")
    @classmethod
    def _utc(cls, v: dt.datetime) -> dt.datetime:
        return v if v.tzinfo else v.replace(tzinfo=dt.timezone.utc)

    @model_validator(mode="after")
    def _required_fields(self) -> "EventIn":
        if self.op in ("read", "write") and not self.fact_key:
            raise ValueError(f"{self.op} needs fact_key")
        if self.op == "handoff" and not self.target_agent:
            raise ValueError("handoff needs target_agent")
        return self


class Decision(BaseModel):
    decided_by: str = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=1000)


class AskBody(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    agent: str | None = None
    fact_key: str | None = None
    since: dt.datetime | None = None
    until: dt.datetime | None = None


class NotebookWrite(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    kind: Literal["memory", "approval"] = "memory"
    datapack: str | None = None


class AgentRuntimeSpec(BaseModel):
    """How one agent is executed. Model ids are configuration, never hard-coded."""
    provider: Literal["claude", "codex", "antigravity", "replay"]
    runtime: Literal["claude_agent_sdk", "codex_app_server", "antigravity_cli", "replay"] | None = None
    model: str | None = None
    enabled: bool = True
    workspace_id: str | None = None
    permissions: dict[Literal["read", "write", "execute"], bool] = {}
    allowed_tools: list[str] | None = None
    permission_mode: str | None = None
    max_turns: int | None = Field(default=None, ge=1, le=200)
    timeout_s: float | None = Field(default=None, gt=0, le=3600)


class DesignSpec(BaseModel):
    """Agents may be plain names, or objects carrying their runtime ({"id", "provider", ...}).
    Objects are normalized into `agents` (names) + `runtimes` (by name), so detectors keep
    reading agent names and memory permissions as before."""
    agents: list[str] = Field(min_length=1)
    handoffs: list[tuple[str, str]] = []
    must_pass_through: dict[str, list[str]] = {}
    permissions: dict[str, dict[Literal["read", "write"], list[str]]] = {}
    runtimes: dict[str, AgentRuntimeSpec] = {}

    @model_validator(mode="before")
    @classmethod
    def _normalize_agents(cls, data):
        if not isinstance(data, dict) or not any(isinstance(a, dict) for a in data.get("agents", [])):
            return data
        names, runtimes = [], dict(data.get("runtimes") or {})
        for a in data["agents"]:
            if isinstance(a, dict):
                a = dict(a)
                name = a.pop("id", None) or a.pop("name", None)
                if not name:
                    raise ValueError("agent objects need an 'id'")
                names.append(name)
                if "provider" in a:
                    runtimes[name] = a
            else:
                names.append(a)
        return {**data, "agents": names, "runtimes": runtimes}

    @model_validator(mode="after")
    def _known_agents(self) -> "DesignSpec":
        known = set(self.agents)
        named = {a for h in self.handoffs for a in h} | set(self.permissions) | set(self.must_pass_through)
        named |= {a for v in self.must_pass_through.values() for a in v} | set(self.runtimes)
        if unknown := named - known:
            raise ValueError(f"unknown agents in design: {sorted(unknown)}")
        return self


@dataclass
class Ev:
    """One stored event, as the detectors see it."""

    event_id: str
    run_id: str
    agent: str
    op: str
    fact_key: str | None
    version: int | None
    value_preview: str | None
    target_agent: str | None
    ts: dt.datetime
    reason: str | None = None
