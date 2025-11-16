-- Create new global divisions table
CREATE TABLE divisions_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create division_configs table for season-specific configuration
CREATE TABLE division_configs (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  practices_per_week INTEGER NOT NULL,
  practice_duration_hours REAL NOT NULL,
  games_per_week INTEGER,
  game_duration_hours REAL,
  min_consecutive_day_gap INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (division_id) REFERENCES divisions_new(id) ON DELETE CASCADE,
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  UNIQUE(division_id, season_id)
);

-- Migrate existing divisions to new structure
-- First, create unique divisions from existing data
INSERT INTO divisions_new (id, name, description, created_at, updated_at)
SELECT DISTINCT
  substr(id, 1, instr(id, '-') - 1) || '-div' as id,
  name,
  description,
  min(created_at) as created_at,
  max(updated_at) as updated_at
FROM divisions
GROUP BY name;

-- Create division configs for each season-division combination
INSERT INTO division_configs (id, division_id, season_id, practices_per_week, practice_duration_hours, games_per_week, game_duration_hours, min_consecutive_day_gap, created_at, updated_at)
SELECT
  d.id,
  substr(d.id, 1, instr(d.id, '-') - 1) || '-div' as division_id,
  d.season_id,
  d.practices_per_week,
  d.practice_duration_hours,
  d.games_per_week,
  d.game_duration_hours,
  d.min_consecutive_day_gap,
  d.created_at,
  d.updated_at
FROM divisions d;

-- Update field_division_compatibility to reference the new division IDs
-- Create a temporary table with updated references
CREATE TABLE field_division_compatibility_new (
  field_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  PRIMARY KEY (field_id, division_id),
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE,
  FOREIGN KEY (division_id) REFERENCES divisions_new(id) ON DELETE CASCADE
);

-- Migrate compatibility data
INSERT INTO field_division_compatibility_new (field_id, division_id)
SELECT DISTINCT
  fdc.field_id,
  substr(fdc.division_id, 1, instr(fdc.division_id, '-') - 1) || '-div' as division_id
FROM field_division_compatibility fdc;

-- Update teams table to reference division_id (global division, not config)
-- Teams will reference the global division, and the season will determine which config to use
-- No changes needed to teams table structure since it already has division_id

-- Drop old tables and rename new ones
DROP TABLE field_division_compatibility;
ALTER TABLE field_division_compatibility_new RENAME TO field_division_compatibility;

DROP TABLE divisions;
ALTER TABLE divisions_new RENAME TO divisions;

-- Create indexes
CREATE INDEX idx_division_configs_division_id ON division_configs(division_id);
CREATE INDEX idx_division_configs_season_id ON division_configs(season_id);
