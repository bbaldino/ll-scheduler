-- Remove the blackout_dates column from division_configs
-- This data has been migrated to seasons.blackout_dates with divisionIds

-- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
CREATE TABLE division_configs_new (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  practices_per_week INTEGER NOT NULL DEFAULT 1,
  practice_duration_hours REAL NOT NULL DEFAULT 1,
  games_per_week INTEGER NOT NULL DEFAULT 1,
  game_duration_hours REAL NOT NULL DEFAULT 2,
  game_arrive_before_hours REAL,
  game_day_preferences TEXT,
  min_consecutive_day_gap INTEGER,
  cage_sessions_per_week INTEGER,
  cage_session_duration_hours REAL,
  field_preferences TEXT,
  game_week_overrides TEXT,
  max_games_per_season INTEGER,
  sunday_paired_practice_enabled INTEGER,
  sunday_paired_practice_duration_hours REAL,
  sunday_paired_practice_field_id TEXT,
  sunday_paired_practice_cage_id TEXT,
  game_spacing_enabled INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(division_id, season_id)
);

-- Copy data from old table (excluding blackout_dates)
INSERT INTO division_configs_new (
  id, division_id, season_id, practices_per_week, practice_duration_hours,
  games_per_week, game_duration_hours, game_arrive_before_hours, game_day_preferences,
  min_consecutive_day_gap, cage_sessions_per_week, cage_session_duration_hours,
  field_preferences, game_week_overrides, max_games_per_season,
  sunday_paired_practice_enabled, sunday_paired_practice_duration_hours,
  sunday_paired_practice_field_id, sunday_paired_practice_cage_id,
  game_spacing_enabled, created_at, updated_at
)
SELECT
  id, division_id, season_id, practices_per_week, practice_duration_hours,
  games_per_week, game_duration_hours, game_arrive_before_hours, game_day_preferences,
  min_consecutive_day_gap, cage_sessions_per_week, cage_session_duration_hours,
  field_preferences, game_week_overrides, max_games_per_season,
  sunday_paired_practice_enabled, sunday_paired_practice_duration_hours,
  sunday_paired_practice_field_id, sunday_paired_practice_cage_id,
  game_spacing_enabled, created_at, updated_at
FROM division_configs;

-- Drop old table and rename new one
DROP TABLE division_configs;
ALTER TABLE division_configs_new RENAME TO division_configs;

-- Recreate index
CREATE INDEX idx_division_configs_season_id ON division_configs(season_id);
