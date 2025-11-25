-- Create schedule_generation_logs table to store scheduling logs for debugging
CREATE TABLE schedule_generation_logs (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  period_ids TEXT NOT NULL, -- JSON array of period IDs
  success INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  statistics TEXT, -- JSON object with statistics
  log TEXT, -- JSON array of SchedulingLogEntry
  errors TEXT, -- JSON array of errors
  warnings TEXT, -- JSON array of warnings
  created_at TEXT NOT NULL
);

-- Index for quick lookup by season
CREATE INDEX idx_schedule_generation_logs_season_id ON schedule_generation_logs(season_id);
CREATE INDEX idx_schedule_generation_logs_created_at ON schedule_generation_logs(created_at);
