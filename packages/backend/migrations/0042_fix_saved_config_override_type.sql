-- Fix the override_type CHECK constraint to use 'added' instead of 'available'
-- to match the actual field_date_overrides and cage_date_overrides tables

-- SQLite doesn't support ALTER TABLE to modify constraints, so we need to recreate the tables

-- Recreate saved_config_field_date_overrides with correct constraint
CREATE TABLE saved_config_field_date_overrides_new (
  id TEXT PRIMARY KEY,
  saved_config_id TEXT NOT NULL REFERENCES saved_configs(id) ON DELETE CASCADE,
  season_field_id TEXT NOT NULL,
  date TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('added', 'blackout')),
  start_time TEXT,
  end_time TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO saved_config_field_date_overrides_new
SELECT * FROM saved_config_field_date_overrides;

DROP TABLE saved_config_field_date_overrides;

ALTER TABLE saved_config_field_date_overrides_new RENAME TO saved_config_field_date_overrides;

CREATE INDEX idx_saved_config_field_date_overrides_saved_config_id ON saved_config_field_date_overrides(saved_config_id);

-- Recreate saved_config_cage_date_overrides with correct constraint
CREATE TABLE saved_config_cage_date_overrides_new (
  id TEXT PRIMARY KEY,
  saved_config_id TEXT NOT NULL REFERENCES saved_configs(id) ON DELETE CASCADE,
  season_cage_id TEXT NOT NULL,
  date TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('added', 'blackout')),
  start_time TEXT,
  end_time TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO saved_config_cage_date_overrides_new
SELECT * FROM saved_config_cage_date_overrides;

DROP TABLE saved_config_cage_date_overrides;

ALTER TABLE saved_config_cage_date_overrides_new RENAME TO saved_config_cage_date_overrides;

CREATE INDEX idx_saved_config_cage_date_overrides_saved_config_id ON saved_config_cage_date_overrides(saved_config_id);
