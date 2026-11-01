-- Reverses 002_agent_runtime.sql. Not applied automatically: run with psql when rolling back.
DROP INDEX IF EXISTS events_by_invocation;
ALTER TABLE events DROP COLUMN IF EXISTS invocation_id;
DROP TABLE IF EXISTS agent_execution_events;
DROP TABLE IF EXISTS agent_invocations;
DROP TABLE IF EXISTS agent_sessions;
