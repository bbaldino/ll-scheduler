-- Create tables for saving and restoring schedule snapshots
-- Allows users to save current schedule state and restore it later

-- Saved schedule metadata
CREATE TABLE saved_schedules (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  event_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_saved_schedules_season_id ON saved_schedules(season_id);

-- Copy of scheduled events for each saved schedule
CREATE TABLE saved_schedule_events (
  id TEXT PRIMARY KEY,
  saved_schedule_id TEXT NOT NULL REFERENCES saved_schedules(id) ON DELETE CASCADE,
  original_event_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('game', 'practice', 'cage')),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  field_id TEXT,
  cage_id TEXT,
  home_team_id TEXT,
  away_team_id TEXT,
  team_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'postponed')),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_saved_schedule_events_schedule_id ON saved_schedule_events(saved_schedule_id);
