-- Add practice and cage scheduling dates to seasons table
ALTER TABLE seasons ADD COLUMN practice_start_date TEXT;
ALTER TABLE seasons ADD COLUMN practice_end_date TEXT;
ALTER TABLE seasons ADD COLUMN cage_start_date TEXT;
ALTER TABLE seasons ADD COLUMN cage_end_date TEXT;

-- Create game_periods table (replaces season_phases for game scheduling only)
CREATE TABLE game_periods (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('regular', 'playoffs', 'makeup')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  auto_schedule INTEGER NOT NULL DEFAULT 1, -- SQLite uses INTEGER for boolean (1 = true, 0 = false)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

-- Create indexes for game_periods
CREATE INDEX idx_game_periods_season_id ON game_periods(season_id);
CREATE INDEX idx_game_periods_sort_order ON game_periods(season_id, sort_order);

-- Migrate existing season_phases data to game_periods
-- Only migrate phases that were used for game scheduling (regular, playoffs)
-- Skip 'preseason' and 'makeup' as they will be handled differently
INSERT INTO game_periods (id, season_id, name, period_type, start_date, end_date, description, sort_order, auto_schedule, created_at, updated_at)
SELECT
  id,
  season_id,
  name,
  CASE
    WHEN phase_type = 'regular' THEN 'regular'
    WHEN phase_type = 'playoffs' THEN 'playoffs'
    WHEN phase_type = 'makeup' THEN 'makeup'
  END as period_type,
  start_date,
  end_date,
  description,
  sort_order,
  CASE WHEN phase_type = 'makeup' THEN 0 ELSE 1 END as auto_schedule,
  created_at,
  updated_at
FROM season_phases
WHERE phase_type IN ('regular', 'playoffs', 'makeup');

-- Update scheduled_events table to reference game_periods instead of season_phases
-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table

-- Step 1: Create new scheduled_events table with game_period_id
CREATE TABLE scheduled_events_new (
  id TEXT PRIMARY KEY,
  game_period_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('game', 'practice', 'cage')),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'postponed')),
  notes TEXT,
  field_id TEXT,
  cage_id TEXT,
  home_team_id TEXT,
  away_team_id TEXT,
  team_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (game_period_id) REFERENCES game_periods(id) ON DELETE CASCADE,
  FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE SET NULL,
  FOREIGN KEY (cage_id) REFERENCES batting_cages(id) ON DELETE SET NULL,
  FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,

  CHECK (
    (event_type = 'game' AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL AND field_id IS NOT NULL AND team_id IS NULL AND cage_id IS NULL) OR
    (event_type = 'practice' AND team_id IS NOT NULL AND field_id IS NOT NULL AND home_team_id IS NULL AND away_team_id IS NULL AND cage_id IS NULL) OR
    (event_type = 'cage' AND team_id IS NOT NULL AND cage_id IS NOT NULL AND field_id IS NULL AND home_team_id IS NULL AND away_team_id IS NULL)
  )
);

-- Step 2: Copy data from old table to new table
INSERT INTO scheduled_events_new
SELECT
  id,
  season_phase_id as game_period_id,
  division_id,
  event_type,
  date,
  start_time,
  end_time,
  status,
  notes,
  field_id,
  cage_id,
  home_team_id,
  away_team_id,
  team_id,
  created_at,
  updated_at
FROM scheduled_events;

-- Step 3: Drop old table
DROP TABLE scheduled_events;

-- Step 4: Rename new table to original name
ALTER TABLE scheduled_events_new RENAME TO scheduled_events;

-- Step 5: Recreate indexes
CREATE INDEX idx_scheduled_events_game_period ON scheduled_events(game_period_id);
CREATE INDEX idx_scheduled_events_division ON scheduled_events(division_id);
CREATE INDEX idx_scheduled_events_date ON scheduled_events(date);
CREATE INDEX idx_scheduled_events_field ON scheduled_events(field_id);
CREATE INDEX idx_scheduled_events_cage ON scheduled_events(cage_id);
CREATE INDEX idx_scheduled_events_home_team ON scheduled_events(home_team_id);
CREATE INDEX idx_scheduled_events_away_team ON scheduled_events(away_team_id);
CREATE INDEX idx_scheduled_events_team ON scheduled_events(team_id);
CREATE INDEX idx_scheduled_events_type_status ON scheduled_events(event_type, status);

-- Drop the old season_phases table
DROP TABLE season_phases;
