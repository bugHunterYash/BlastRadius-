"""Settings from environment variables (backend/.env).

Every external service is optional so the stack runs offline:
no MEKO_MCP_URL  -> the local notebook table stands in for the Meko Datapack
no OLLAMA_MODEL  -> the Summarizer stores a plain counted digest (also if Ollama is down)
no ANTHROPIC key -> the Fixer uses rule-based template fixes (model = "template")
"""

from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

TOWER_ROOT = Path(__file__).resolve().parents[2]
DEV_TOKEN = "dev-ingest-token-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=TOWER_ROOT / "backend" / ".env", extra="ignore")

    DATABASE_URL: str = "postgresql://postgres:tower@localhost:5433/tower"  # plain PostgreSQL

    MEKO_MCP_URL: str = ""
    MEKO_API_KEY: str = ""
    MEKO_DATAPACK: str = "content-team"
    MEKO_DATAPACK_ID: str = ""            # empty = the datapack named MEKO_DATAPACK, else the first one
    MEKO_AGENT_ID: str = "control-tower"  # who the tower writes to Meko as
    # Real tool names come from list_meko_tools() on day one (verify). Nothing
    # else in the code hard-codes a Meko tool name.
    MEKO_TOOL_WRITE: str = "memory_add"
    MEKO_TOOL_SEARCH: str = "memory_search"
    MEKO_TEXT_ARG: str = "text"
    MEKO_QUERY_ARG: str = "query"

    # Summarizer runs on a local Ollama model: free, and the run data never leaves the machine.
    OLLAMA_URL: str = Field("http://localhost:11434", validation_alias=AliasChoices("OLLAMA_BASE_URL", "OLLAMA_URL"))
    OLLAMA_MODEL: str = "qwen2.5:0.5b"   # lightest; qwen2.5:1.5b reads better if the PC has room
    OLLAMA_TIMEOUT_S: float = 120.0
    OLLAMA_NUM_CTX: int = 4096
    OLLAMA_KEEP_ALIVE: str = "10m"
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-5-5"
    LLM_TIMEOUT_S: float = 30.0

    # ---- Agent runtimes (real Claude Code / Codex executions) ----
    # Claude Agent SDK. Auth: ANTHROPIC_API_KEY if set, otherwise the Claude Code CLI's own login.
    CLAUDE_RUNTIME_ENABLED: bool = True
    CLAUDE_AGENT_MODEL: str = ""          # empty = the CLI's default model (CLAUDE_MODEL is the Fixer's)
    CLAUDE_CLI_PATH: str = ""             # empty = the CLI bundled with claude-agent-sdk
    # Codex App Server over stdio JSON-RPC. Auth: the Codex CLI's own login (ChatGPT or API key).
    CODEX_RUNTIME_ENABLED: bool = True
    # BlastX: the BlastRadius engine that maps an architecture and works out what a failure breaks
    BLASTX_URL: str = "http://127.0.0.1:8000"
    BLASTX_DEMO_COMPOSE: Path = TOWER_ROOT.parent / "tests" / "fixtures" / "demo-compose.yaml"

    ANTIGRAVITY_RUNTIME_ENABLED: bool = True
    ANTIGRAVITY_BIN: str = ""            # empty = `agy` on PATH, else ~/.gemini/bin/agy
    ANTIGRAVITY_MODEL: str = "gemini-3.8-flash-medium"
    ANTIGRAVITY_DIR: str = ""            # where Antigravity keeps chats; empty = ~/.gemini/antigravity
    CODEX_BIN: str = "codex"
    CODEX_MODEL: str = ""                 # empty = Codex's configured default
    CODEX_SANDBOX: str = "workspace-write"
    CODEX_APPROVAL_POLICY: str = "on-request"
    # Replays a recorded transcript. Off by default; every record says runtime="replay".
    REPLAY_RUNTIME_ENABLED: bool = False
    REPLAY_DIR: Path = TOWER_ROOT / "demo-agents" / "transcripts"

    # Live sync: sessions from the Claude app / Claude Code and Codex app threads show up in the tower.
    LIVE_SYNC_ENABLED: bool = True
    LIVE_SYNC_INTERVAL_S: float = 5.0
    LIVE_SYNC_LIMIT: int = 20             # newest sessions/threads per app per pass
    LIVE_SYNC_CLAUDE_DIR: str = ""        # only sessions under this project dir; empty = all projects

    AGENT_WORKSPACE_ROOT: Path = TOWER_ROOT / "workspaces"
    AGENT_WORKSPACES: str = ""            # optional comma list; empty = any directory under the root
    AGENT_MAX_CONCURRENCY: int = 2
    AGENT_DEFAULT_TIMEOUT: float = 300.0
    AGENT_DEFAULT_MAX_TURNS: int = 12
    AGENT_DEFAULT_PERMISSION_MODE: str = "default"   # never bypassPermissions by default

    TOWER_API_TOKEN: str = ""             # for invoke/cancel; falls back to TOWER_INGEST_TOKEN
    TOWER_INGEST_TOKEN: str = DEV_TOKEN
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    ASK_PER_MINUTE: int = 10

    DESIGN_PATH: Path = TOWER_ROOT / "design" / "design.json"
    AGENT_CONFIG_DIR: Path = TOWER_ROOT / "demo-agents" / "config"
    APPLY_GIT_COMMIT: bool = False

    @property
    def notebook_mode(self) -> str:
        return "meko" if self.MEKO_MCP_URL else "local"


settings = Settings()
