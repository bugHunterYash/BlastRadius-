-- Project folders agents may be assigned work in (beside the named workspaces under AGENT_WORKSPACE_ROOT).
-- Added from the UI, only for folders where a synced agent session already works. Safe to re-run.
CREATE TABLE IF NOT EXISTS project_workspaces (
  workspace_id TEXT PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
