-- What each agent in a project run wrote to the shared memory, so the next agent can read it back.
-- meko_ref points at the copy in Meko (or the local notebook); text is kept here too, so a run still
-- works when Meko can't be reached. Safe to re-run.
CREATE TABLE IF NOT EXISTS team_memory (
  event_id   UUID PRIMARY KEY,
  run_id     TEXT NOT NULL,
  agent      TEXT NOT NULL,
  fact_key   TEXT NOT NULL,
  version    INT  NOT NULL,
  meko_ref   TEXT,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS team_memory_by_run ON team_memory (run_id, fact_key, version DESC);
