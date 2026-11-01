-- Agent Control Tower schema (PostgreSQL 14+). Safe to re-run.
CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  datapack    TEXT NOT NULL,
  scenario    TEXT,                               -- groups reruns so fixes can be verified
  status      TEXT NOT NULL DEFAULT 'running',    -- running | analysing | done | error
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS events (
  event_id      UUID PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(run_id),
  agent         TEXT NOT NULL,
  op            TEXT NOT NULL CHECK (op IN ('run_start','run_end','read','write','handoff')),
  fact_key      TEXT,
  version       INT,
  value_preview TEXT,
  target_agent  TEXT,
  reason        TEXT,                             -- why the agent did it, in its own words
  ts            TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS reason TEXT;
CREATE INDEX IF NOT EXISTS events_by_run  ON events (run_id, ts);
CREATE INDEX IF NOT EXISTS events_by_fact ON events (fact_key, ts DESC);

CREATE TABLE IF NOT EXISTS facts (
  fact_key       TEXT PRIMARY KEY,
  latest_version INT NOT NULL,
  updated_by     TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS design_snapshots (
  design_id  UUID PRIMARY KEY,
  spec       JSONB NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS issues (
  issue_id   UUID PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs(run_id),
  type       TEXT NOT NULL CHECK (type IN ('stale_read','conflict','skipped_handoff','permission_leak')),
  agent      TEXT NOT NULL,
  fact_key   TEXT,
  evidence   JSONB NOT NULL,                      -- event_ids that prove it
  detail     TEXT,                                -- one line, written by the detector
  note       TEXT,                                -- why a fix was dropped, or how verification went
  status     TEXT NOT NULL DEFAULT 'open',        -- open | fix_ready | approved | rejected | resolved
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id, type, agent, fact_key)
);

CREATE TABLE IF NOT EXISTS fixes (
  fix_id      UUID PRIMARY KEY,
  issue_id    UUID NOT NULL REFERENCES issues(issue_id),
  explanation TEXT NOT NULL,
  fix_type    TEXT NOT NULL,                      -- prompt | permission | handoff_rule | routing
  patch       JSONB NOT NULL,                     -- target_agent, before, after, risk, verify_by
  model       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id UUID PRIMARY KEY,
  fix_id      UUID NOT NULL REFERENCES fixes(fix_id),
  decision    TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  decided_by  TEXT NOT NULL,
  note        TEXT,
  meko_ref    TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS digests (
  digest_id  UUID PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs(run_id),
  summary    TEXT NOT NULL,                       -- JSON digest: headline, by_agent, notable
  model      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Local stand-in for the Meko Datapack, used only when MEKO_MCP_URL is unset.
CREATE TABLE IF NOT EXISTS notebook_items (
  item_id    UUID PRIMARY KEY,
  datapack   TEXT NOT NULL,
  kind       TEXT NOT NULL,                       -- memory | approval
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS notebook_by_pack ON notebook_items (datapack, created_at DESC);
