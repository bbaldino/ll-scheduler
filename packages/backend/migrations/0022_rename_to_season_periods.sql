-- Rename game_periods to season_periods and add event_types column
-- This supports overlapping periods with different event types (games, practices, cages)

-- Step 1: Create new season_periods table with event_types column
CREATE TABLE season_periods (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  event_types TEXT NOT NULL DEFAULT 'game', -- Comma-separated: 'game', 'practice', 'cage'
  auto_schedule INTEGER NOT NULL DEFAULT 1, -- SQLite uses INTEGER for boolean (1 = true, 0 = false)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

-- Step 2: Migrate existing game_periods data to season_periods
-- All existing game_periods become season_periods with eventTypes: ['game']
INSERT INTO season_periods (id, season_id, name, start_date, end_date, event_types, auto_schedule, sort_order, created_at, updated_at)
SELECT
  id,
  season_id,
  name,
  start_date,
  end_date,
  'game' as event_types,
  auto_schedule,
  sort_order,
  created_at,
  updated_at
FROM game_periods;

-- Step 3: Create indexes for season_periods
CREATE INDEX idx_season_periods_season_id ON season_periods(season_id);
CREATE INDEX idx_season_periods_sort_order ON season_periods(season_id, sort_order);

-- Step 4: Update scheduled_events to reference season_periods instead of game_periods
-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table

CREATE TABLE scheduled_events_new (
  id TEXT PRIMARY KEY,
  season_period_id TEXT NOT NULL,
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

  FOREIGN KEY (season_period_id) REFERENCES season_periods(id) ON DELETE CASCADE,
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

-- Step 5: Copy data from old scheduled_events to new table
INSERT INTO scheduled_events_new
SELECT
  id,
  game_period_id as season_period_id,
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

-- Step 6: Drop old scheduled_events table
DROP TABLE scheduled_events;

-- Step 7: Rename new table to original name
ALTER TABLE scheduled_events_new RENAME TO scheduled_events;

-- Step 8: Recreate indexes for scheduled_events
CREATE INDEX idx_scheduled_events_season_period ON scheduled_events(season_period_id);
CREATE INDEX idx_scheduled_events_division ON scheduled_events(division_id);
CREATE INDEX idx_scheduled_events_date ON scheduled_events(date);
CREATE INDEX idx_scheduled_events_field ON scheduled_events(field_id);
CREATE INDEX idx_scheduled_events_cage ON scheduled_events(cage_id);
CREATE INDEX idx_scheduled_events_home_team ON scheduled_events(home_team_id);
CREATE INDEX idx_scheduled_events_away_team ON scheduled_events(away_team_id);
CREATE INDEX idx_scheduled_events_team ON scheduled_events(team_id);
CREATE INDEX idx_scheduled_events_type_status ON scheduled_events(event_type, status);

-- Step 9: Drop old game_periods table
DROP TABLE game_periods;
