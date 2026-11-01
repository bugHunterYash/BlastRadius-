-- What a run is for: the brief a person wrote when starting a project. The report reads it. Safe to re-run.
CREATE TABLE IF NOT EXISTS project_briefs (
  run_id       TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  goal         TEXT NOT NULL,
  deliverable  TEXT NOT NULL,
  phases       JSONB NOT NULL,              -- [{id, label, agent}] in order
  workspace_id TEXT,                        -- project folder the agents work in, if any
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
