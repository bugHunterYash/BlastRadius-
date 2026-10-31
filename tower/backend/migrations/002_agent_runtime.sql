-- Agent runtime execution capture (Claude Agent SDK, Codex App Server). Safe to re-run.
-- Kept apart from the memory `events` table; the two are joined through run_id and invocation_id.

CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id          UUID PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES runs(run_id),
  agent_id            TEXT NOT NULL,
  provider            TEXT NOT NULL,                 -- claude | codex | replay
  provider_session_id TEXT,                          -- Claude session id / Codex thread id
  workspace_id        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS agent_sessions_by_run ON agent_sessions (run_id, agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_provider_id
  ON agent_sessions (provider, provider_session_id) WHERE provider_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_invocations (
  invocation_id      UUID PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES runs(run_id),
  agent_id           TEXT NOT NULL,
  session_id         UUID REFERENCES agent_sessions(session_id),
  provider           TEXT NOT NULL,
  runtime            TEXT NOT NULL,                  -- claude_agent_sdk | codex_app_server | replay
  model              TEXT,
  workspace_id       TEXT NOT NULL,
  provider_thread_id TEXT,
  provider_turn_id   TEXT,
  why                TEXT,                           -- why the orchestrator asked for this invocation
  system_prompt      TEXT,
  user_prompt        TEXT NOT NULL,
  final_response     TEXT,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','completed','failed','cancelled','timeout')),
  error_message      TEXT,
  input_tokens       BIGINT,
  output_tokens      BIGINT,
  usage              JSONB,
  routing            JSONB NOT NULL DEFAULT '{}',    -- the complete routing decision
  metadata           JSONB NOT NULL DEFAULT '{}',
  last_sequence      BIGINT NOT NULL DEFAULT 0,      -- per-invocation event counter
  idempotency_key    TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_invocations_by_run   ON agent_invocations (run_id, created_at);
CREATE INDEX IF NOT EXISTS agent_invocations_by_agent ON agent_invocations (agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_execution_events (
  event_id      UUID PRIMARY KEY,
  invocation_id UUID NOT NULL REFERENCES agent_invocations(invocation_id) ON DELETE CASCADE,
  sequence      BIGINT NOT NULL,
  event_type    TEXT NOT NULL,                       -- prompt.received, message.delta, tool.started, ...
  why           TEXT,                                -- public explanation, or NULL when none was exposed
  payload       JSONB NOT NULL DEFAULT '{}',
  dedupe_key    TEXT,                                -- provider item id + phase, so replays never duplicate
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (invocation_id, sequence),
  UNIQUE (invocation_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS agent_events_by_type ON agent_execution_events (invocation_id, event_type);

-- Memory events written while an agent invocation was running point back to it.
ALTER TABLE events ADD COLUMN IF NOT EXISTS invocation_id UUID;
CREATE INDEX IF NOT EXISTS events_by_invocation ON events (invocation_id) WHERE invocation_id IS NOT NULL;
