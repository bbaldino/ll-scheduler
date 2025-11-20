-- Create scheduled_events table for games, practices, and cage sessions
CREATE TABLE IF NOT EXISTS scheduled_events (
  id TEXT PRIMARY KEY,
  season_phase_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('game', 'practice', 'cage')),
  date TEXT NOT NULL, -- ISO date (YYYY-MM-DD)
  start_time TEXT NOT NULL, -- HH:MM format
  end_time TEXT NOT NULL, -- HH:MM format
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'postponed')),
  notes TEXT,

  -- Resource assignment (field or cage)
  field_id TEXT,
  cage_id TEXT,

  -- Game-specific fields
  home_team_id TEXT,
  away_team_id TEXT,

  -- Practice and cage-specific fields
  team_id TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (season_phase_id) REFERENCES season_phases(id) ON DELETE CASCADE,
  FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE SET NULL,
  FOREIGN KEY (cage_id) REFERENCES batting_cages(id) ON DELETE SET NULL,
  FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,

  -- Validation: games must have home and away teams, field
  CHECK (
    (event_type = 'game' AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL AND field_id IS NOT NULL AND team_id IS NULL AND cage_id IS NULL) OR
    (event_type = 'practice' AND team_id IS NOT NULL AND field_id IS NOT NULL AND home_team_id IS NULL AND away_team_id IS NULL AND cage_id IS NULL) OR
    (event_type = 'cage' AND team_id IS NOT NULL AND cage_id IS NOT NULL AND field_id IS NULL AND home_team_id IS NULL AND away_team_id IS NULL)
  )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_scheduled_events_season_phase ON scheduled_events(season_phase_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_division ON scheduled_events(division_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_date ON scheduled_events(date);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_field ON scheduled_events(field_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_cage ON scheduled_events(cage_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_home_team ON scheduled_events(home_team_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_away_team ON scheduled_events(away_team_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_team ON scheduled_events(team_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_type_status ON scheduled_events(event_type, status);
