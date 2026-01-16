-- Saved configuration snapshots for seasons
-- Allows saving and restoring all config needed to regenerate a schedule

-- Main saved config metadata
CREATE TABLE saved_configs (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  season_blackout_dates TEXT, -- JSON array of SeasonBlackout objects
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_saved_configs_season_id ON saved_configs(season_id);

-- Division config snapshots (one row per division config in the saved config)
CREATE TABLE saved_config_division_configs (
  id TEXT PRIMARY KEY,
  saved_config_id TEXT NOT NULL REFERENCES saved_configs(id) ON DELETE CASCADE,
  division_id TEXT NOT NULL,
  config_json TEXT NOT NULL, -- Full DivisionConfig as JSON (excluding id, seasonId, createdAt, updatedAt)
  created_at TEXT NOT NULL
);
CREATE INDEX idx_saved_config_division_configs_saved_config_id ON saved_config_division_configs(saved_config_id);

-- Field availability snapshots
CREATE TABLE saved_config_field_availabilities (
  id TEXT PRIMARY KEY,
  saved_config_id TEXT NOT NULL REFERENCES saved_configs(id) ON DELETE CASCADE,
  season_field_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_saved_config_field_availabilities_saved_config_id ON saved_config_field_availabilities(saved_config_id);

-- Cage availability snapshots
CREATE TABLE saved_config_cage_availabilities (
  id TEXT PRIMARY KEY,
  saved_config_id TEXT NOT NULL REFERENCES saved_configs(id) ON DELETE CASCADE,
  season_cage_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_saved_config_cage_availabilities_saved_config_id ON saved_config_cage_availabilities(saved_config_id);

-- Field date override snapshots
CREATE TABLE saved_config_field_date_overrides (
  id TEXT PRIMARY KEY,
  saved_config_id TEXT NOT NULL REFERENCES saved_configs(id) ON DELETE CASCADE,
  season_field_id TEXT NOT NULL,
  date TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('available', 'blackout')),
  start_time TEXT,
  end_time TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_saved_config_field_date_overrides_saved_config_id ON saved_config_field_date_overrides(saved_config_id);

-- Cage date override snapshots
CREATE TABLE saved_config_cage_date_overrides (
  id TEXT PRIMARY KEY,
  saved_config_id TEXT NOT NULL REFERENCES saved_configs(id) ON DELETE CASCADE,
  season_cage_id TEXT NOT NULL,
  date TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('available', 'blackout')),
  start_time TEXT,
  end_time TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_saved_config_cage_date_overrides_saved_config_id ON saved_config_cage_date_overrides(saved_config_id);
