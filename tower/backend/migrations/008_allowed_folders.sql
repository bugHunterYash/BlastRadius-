-- Folders the person allowed the tower to see. Live sync imports a chat from the Claude, Codex or Antigravity
-- app only when it works in one of these (or a folder inside one). seen_folders lists folders the apps have
-- chats in that aren't allowed yet (the path only, never a chat), so the person can choose. Safe to re-run.
CREATE TABLE IF NOT EXISTS allowed_folders (
  path       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  allowed_by TEXT,
  allowed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS seen_folders (
  path       TEXT PRIMARY KEY,
  apps       TEXT[] NOT NULL DEFAULT '{}',
  chats      INT NOT NULL DEFAULT 0,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
