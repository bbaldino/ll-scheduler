-- Remove season_periods concept and add games_start_date to seasons
-- This simplifies scheduling: practices/cages run from startDate to endDate,
-- games run from gamesStartDate to endDate

-- Step 1: Add games_start_date column to seasons table
ALTER TABLE seasons ADD COLUMN games_start_date TEXT;

-- Step 2: Recreate scheduled_events without season_period_id, add season_id instead
CREATE TABLE scheduled_events_new (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
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

  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
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

-- Step 3: Copy data from old scheduled_events to new table
-- Get season_id from the season_periods table
INSERT INTO scheduled_events_new
SELECT
  se.id,
  sp.season_id,
  se.division_id,
  se.event_type,
  se.date,
  se.start_time,
  se.end_time,
  se.status,
  se.notes,
  se.field_id,
  se.cage_id,
  se.home_team_id,
  se.away_team_id,
  se.team_id,
  se.created_at,
  se.updated_at
FROM scheduled_events se
JOIN season_periods sp ON se.season_period_id = sp.id;

-- Step 4: Drop old scheduled_events table
DROP TABLE scheduled_events;

-- Step 5: Rename new table to original name
ALTER TABLE scheduled_events_new RENAME TO scheduled_events;

-- Step 6: Recreate indexes for scheduled_events
CREATE INDEX idx_scheduled_events_season ON scheduled_events(season_id);
CREATE INDEX idx_scheduled_events_division ON scheduled_events(division_id);
CREATE INDEX idx_scheduled_events_date ON scheduled_events(date);
CREATE INDEX idx_scheduled_events_field ON scheduled_events(field_id);
CREATE INDEX idx_scheduled_events_cage ON scheduled_events(cage_id);
CREATE INDEX idx_scheduled_events_home_team ON scheduled_events(home_team_id);
CREATE INDEX idx_scheduled_events_away_team ON scheduled_events(away_team_id);
CREATE INDEX idx_scheduled_events_team ON scheduled_events(team_id);
CREATE INDEX idx_scheduled_events_type_status ON scheduled_events(event_type, status);

-- Step 7: Update schedule_generation_logs - remove period_ids column
-- SQLite doesn't support DROP COLUMN in older versions, so recreate the table
CREATE TABLE schedule_generation_logs_new (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  success INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  statistics TEXT,
  log TEXT,
  errors TEXT,
  warnings TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO schedule_generation_logs_new (id, season_id, success, events_created, message, statistics, log, errors, warnings, created_at)
SELECT id, season_id, success, events_created, message, statistics, log, errors, warnings, created_at
FROM schedule_generation_logs;

DROP TABLE schedule_generation_logs;
ALTER TABLE schedule_generation_logs_new RENAME TO schedule_generation_logs;

CREATE INDEX idx_schedule_generation_logs_season_id ON schedule_generation_logs(season_id);
CREATE INDEX idx_schedule_generation_logs_created_at ON schedule_generation_logs(created_at);

-- Step 8: Drop the season_periods table
DROP TABLE season_periods;
