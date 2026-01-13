-- Update the event_type CHECK constraint to include 'paired_practice'
-- SQLite requires recreating the table to modify a CHECK constraint

-- Create new table with updated constraint
CREATE TABLE scheduled_events_new (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('game', 'practice', 'cage', 'paired_practice')),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  field_id TEXT,
  cage_id TEXT,
  home_team_id TEXT,
  away_team_id TEXT,
  team_id TEXT,
  team1_id TEXT,
  team2_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'postponed')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (division_id) REFERENCES divisions(id)
);

-- Copy data from old table
INSERT INTO scheduled_events_new
SELECT id, season_id, division_id, event_type, date, start_time, end_time,
       field_id, cage_id, home_team_id, away_team_id, team_id, team1_id, team2_id,
       status, notes, created_at, updated_at
FROM scheduled_events;

-- Drop old table
DROP TABLE scheduled_events;

-- Rename new table
ALTER TABLE scheduled_events_new RENAME TO scheduled_events;

-- Recreate indexes
CREATE INDEX idx_scheduled_events_season ON scheduled_events(season_id);
CREATE INDEX idx_scheduled_events_division ON scheduled_events(division_id);
CREATE INDEX idx_scheduled_events_date ON scheduled_events(date);
CREATE INDEX idx_scheduled_events_field ON scheduled_events(field_id);
CREATE INDEX idx_scheduled_events_cage ON scheduled_events(cage_id);
