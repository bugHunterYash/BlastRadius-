-- Whether a run's agents shared memory through Meko ("meko"), a local table ("local"), or worked alone ("off").
-- Set when a project run starts, so its report can say how it ran. Safe to re-run.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS memory_mode TEXT;
