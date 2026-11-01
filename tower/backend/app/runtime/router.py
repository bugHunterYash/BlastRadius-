"""Agent router: turns (agent_id, active design) into a validated AgentRoute and picks the runtime.

The design's `runtimes` map says which provider runs each agent:
  "runtimes": {"researcher": {"provider": "codex", "model": null, "workspace_id": "demo-workspace",
                              "permissions": {"read": true, "write": false, "execute": true}}}
Nothing provider-specific lives here beyond the provider -> runtime name table.
"""

import re

from app import agent_config
from app.config import settings
from app.runtime import workspace
from app.runtime.base import AgentRuntime
from app.runtime.models import AgentRoute

PROVIDER_RUNTIME = {"claude": "claude_agent_sdk", "codex": "codex_app_server", "antigravity": "antigravity_cli",
                    "replay": "replay"}
PROVIDER_ENABLED = {
    "claude": lambda: settings.CLAUDE_RUNTIME_ENABLED,
    "codex": lambda: settings.CODEX_RUNTIME_ENABLED,
    "antigravity": lambda: settings.ANTIGRAVITY_RUNTIME_ENABLED,
    "replay": lambda: settings.REPLAY_RUNTIME_ENABLED,
}
DEFAULT_MODEL = {"claude": lambda: settings.CLAUDE_AGENT_MODEL, "codex": lambda: settings.CODEX_MODEL,
                 "antigravity": lambda: settings.ANTIGRAVITY_MODEL,
                 "replay": lambda: ""}
_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,99}$")
READ_TOOLS, WRITE_TOOLS, EXEC_TOOLS = ["Read", "Glob", "Grep"], ["Edit", "Write"], ["Bash"]
UNSAFE_MODES = {"bypassPermissions"}


class RoutingError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


_registry: dict[str, AgentRuntime] = {}


def registry() -> dict[str, AgentRuntime]:
    if not _registry:
        from app.runtime.antigravity_cli import AntigravityRuntime
        from app.runtime.claude_sdk import ClaudeRuntime
        from app.runtime.codex_app_server import CodexRuntime
        from app.runtime.replay import ReplayRuntime
        _registry.update({r.name: r for r in (ClaudeRuntime(), CodexRuntime(), AntigravityRuntime(), ReplayRuntime())})
    return _registry


def set_runtime(runtime: AgentRuntime) -> None:
    """Swap an adapter (tests use this to plug in protocol fakes)."""
    registry()[runtime.name] = runtime


def system_prompt(agent_id: str) -> str | None:
    """Application-owned instructions from demo-agents/config/<agent>.yaml (what the Fixer edits)."""
    cfg = agent_config.load(agent_id)
    if not cfg:
        return None
    lines = [f"You are the {agent_id} agent in a multi-agent team.", cfg.get("prompt", "")]
    if cfg.get("handoff_rule"):
        lines.append(f"Handoff rule: {cfg['handoff_rule']}.")
    if cfg.get("routing"):
        lines.append(f"When done: {cfg['routing']}.")
    return "\n".join(l for l in lines if l)


def resolve(agent_id: str, design: dict, workspace_override: str | None = None,
            design_id: str | None = None, read_only: bool = False) -> AgentRoute:
    if agent_id not in design.get("agents", []):
        raise RoutingError(404, f"agent {agent_id!r} is not in the active design")
    rt = (design.get("runtimes") or {}).get(agent_id)
    if not rt:
        raise RoutingError(422, f"agent {agent_id!r} has no runtime configured in the design")
    provider = rt.get("provider")
    if provider not in PROVIDER_RUNTIME:
        raise RoutingError(422, f"unknown provider {provider!r} for {agent_id}")
    runtime = rt.get("runtime") or PROVIDER_RUNTIME[provider]
    if runtime != PROVIDER_RUNTIME[provider]:
        raise RoutingError(422, f"runtime {runtime!r} does not match provider {provider!r}")
    if not rt.get("enabled", True):
        raise RoutingError(409, f"agent {agent_id!r} is disabled in the design")
    if not PROVIDER_ENABLED[provider]():
        raise RoutingError(409, f"provider {provider!r} is disabled on this server")

    model = rt.get("model")
    if model is not None and (not isinstance(model, str) or (model and not _MODEL.match(model))):
        raise RoutingError(422, f"invalid model setting for {agent_id}: {model!r}")
    model = model or DEFAULT_MODEL[provider]() or None

    ws_id = workspace_override or rt.get("workspace_id")
    if not ws_id:
        raise RoutingError(422, f"no workspace for {agent_id}")
    try:
        ws_path = workspace.resolve(ws_id)
    except workspace.WorkspaceError as exc:
        raise RoutingError(422, str(exc)) from exc

    perms = {"read": True, "write": False, "execute": False, **(rt.get("permissions") or {})}
    if read_only:
        perms.update(write=False, execute=False)
    tools = (None if read_only else rt.get("allowed_tools")) or (
        (READ_TOOLS if perms["read"] else []) + (WRITE_TOOLS if perms["write"] else [])
        + (EXEC_TOOLS if perms["execute"] else []))
    mode = rt.get("permission_mode") or settings.AGENT_DEFAULT_PERMISSION_MODE
    if mode in UNSAFE_MODES:
        raise RoutingError(422, f"permission mode {mode!r} is not allowed")
    sandbox = "workspace-write" if perms["write"] else "read-only"
    if provider == "codex" and perms["write"] and settings.CODEX_SANDBOX in ("read-only", "workspace-write"):
        sandbox = settings.CODEX_SANDBOX

    return AgentRoute(
        agent_id=agent_id, provider=provider, runtime=runtime, model=model,
        workspace_id=ws_id, workspace_path=str(ws_path), system_prompt=system_prompt(agent_id),
        allowed_tools=list(tools), permissions=perms, permission_mode=mode, sandbox=sandbox,
        max_turns=int(rt.get("max_turns") or settings.AGENT_DEFAULT_MAX_TURNS),
        timeout_s=float(rt.get("timeout_s") or settings.AGENT_DEFAULT_TIMEOUT), design_id=design_id,
    )
