-- Make games_per_week and game_duration_hours required fields
-- First update any existing rows with null values to have defaults

UPDATE division_configs SET games_per_week = 1 WHERE games_per_week IS NULL;
UPDATE division_configs SET game_duration_hours = 2 WHERE game_duration_hours IS NULL;

-- SQLite doesn't support ALTER COLUMN to change nullability, so we need to recreate the table
CREATE TABLE division_configs_new (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  practices_per_week INTEGER NOT NULL,
  practice_duration_hours REAL NOT NULL,
  games_per_week INTEGER NOT NULL DEFAULT 1,
  game_duration_hours REAL NOT NULL DEFAULT 2,
  game_day_preferences TEXT,
  min_consecutive_day_gap INTEGER,
  cage_sessions_per_week INTEGER,
  cage_session_duration_hours REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE,
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  UNIQUE(division_id, season_id)
);

INSERT INTO division_configs_new
SELECT * FROM division_configs;

DROP TABLE division_configs;

ALTER TABLE division_configs_new RENAME TO division_configs;
