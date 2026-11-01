-- Synced chats the person chose to hide (e.g. from an earlier account): live sync never imports them again.
-- Only the tower's copy goes; the chat stays in its own app. Safe to re-run.
CREATE TABLE IF NOT EXISTS hidden_chats (
  thread_id  TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  title      TEXT,
  hidden_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
