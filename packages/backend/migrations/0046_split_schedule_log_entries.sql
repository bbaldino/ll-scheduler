-- Create a separate table for schedule generation log entries
-- This avoids hitting SQLite blob size limits when storing large logs

CREATE TABLE schedule_generation_log_entries (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES schedule_generation_logs(id) ON DELETE CASCADE,
  entry_index INTEGER NOT NULL, -- Preserve ordering
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL, -- 'info', 'warning', 'error', 'debug'
  category TEXT NOT NULL, -- 'game', 'practice', 'cage', 'resource', 'general'
  message TEXT NOT NULL,
  summary TEXT,
  details TEXT -- JSON object for flexible additional data
);

-- Index for efficient retrieval by log_id
CREATE INDEX idx_schedule_log_entries_log_id ON schedule_generation_log_entries(log_id);

-- Drop the old log column from the main table (it's now in the entries table)
-- SQLite doesn't support DROP COLUMN directly in older versions, so we recreate the table

-- Create new table without log column
CREATE TABLE schedule_generation_logs_new (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  success INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  statistics TEXT,
  errors TEXT,
  warnings TEXT,
  created_at TEXT NOT NULL
);

-- Copy data (excluding the log column)
INSERT INTO schedule_generation_logs_new (id, season_id, success, events_created, message, statistics, errors, warnings, created_at)
SELECT id, season_id, success, events_created, message, statistics, errors, warnings, created_at
FROM schedule_generation_logs;

-- Drop old table and rename
DROP TABLE schedule_generation_logs;
ALTER TABLE schedule_generation_logs_new RENAME TO schedule_generation_logs;

-- Recreate indexes
CREATE INDEX idx_schedule_generation_logs_season_id ON schedule_generation_logs(season_id);
CREATE INDEX idx_schedule_generation_logs_created_at ON schedule_generation_logs(created_at);
