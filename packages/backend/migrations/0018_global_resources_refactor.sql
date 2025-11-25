-- Migration: Refactor fields and cages to be global resources with season-specific configurations
--
-- This migration:
-- 1. Makes fields global (removes season_id)
-- 2. Creates season_fields to link fields to seasons with configuration
-- 3. Creates season_cages to link cages to seasons with configuration
-- 4. Adds season_id to availability and override tables

-- ============================================================
-- STEP 1: Create new global fields table
-- ============================================================

CREATE TABLE fields_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy existing fields (deduplicate by name, keeping most recent)
INSERT INTO fields_new (id, name, created_at, updated_at)
SELECT id, name, created_at, updated_at FROM fields
GROUP BY name
ORDER BY created_at DESC;

-- ============================================================
-- STEP 2: Create season_fields table
-- ============================================================

CREATE TABLE season_fields (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  division_compatibility TEXT NOT NULL DEFAULT '[]', -- JSON array of division IDs
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES fields_new(id) ON DELETE CASCADE,
  UNIQUE(season_id, field_id)
);

CREATE INDEX idx_season_fields_season_id ON season_fields(season_id);
CREATE INDEX idx_season_fields_field_id ON season_fields(field_id);

-- Migrate existing field-season relationships
-- First insert the season_fields records
INSERT INTO season_fields (id, season_id, field_id, division_compatibility, created_at, updated_at)
SELECT
  f.id || '-sf',
  f.season_id,
  (SELECT id FROM fields_new WHERE name = f.name LIMIT 1),
  COALESCE(
    (SELECT '[' || GROUP_CONCAT('"' || fdc.division_id || '"') || ']'
     FROM field_division_compatibility fdc
     WHERE fdc.field_id = f.id),
    '[]'
  ),
  f.created_at,
  f.updated_at
FROM fields f;

-- ============================================================
-- STEP 3: Create new field_availabilities table with season_id
-- ============================================================

CREATE TABLE field_availabilities_new (
  id TEXT PRIMARY KEY,
  season_field_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_field_id) REFERENCES season_fields(id) ON DELETE CASCADE
);

CREATE INDEX idx_field_availabilities_season_field_id ON field_availabilities_new(season_field_id);

-- Migrate existing field availabilities
INSERT INTO field_availabilities_new (id, season_field_id, day_of_week, start_time, end_time, created_at, updated_at)
SELECT
  fa.id,
  f.id || '-sf',
  fa.day_of_week,
  fa.start_time,
  fa.end_time,
  fa.created_at,
  fa.updated_at
FROM field_availabilities fa
JOIN fields f ON fa.field_id = f.id;

-- ============================================================
-- STEP 4: Create new field_date_overrides table with season_field_id
-- ============================================================

CREATE TABLE field_date_overrides_new (
  id TEXT PRIMARY KEY,
  season_field_id TEXT NOT NULL,
  date TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('blackout', 'added')),
  start_time TEXT,
  end_time TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_field_id) REFERENCES season_fields(id) ON DELETE CASCADE
);

CREATE INDEX idx_field_date_overrides_new_season_field_id ON field_date_overrides_new(season_field_id);
CREATE INDEX idx_field_date_overrides_new_date ON field_date_overrides_new(date);

-- Migrate existing field date overrides
INSERT INTO field_date_overrides_new (id, season_field_id, date, override_type, start_time, end_time, reason, created_at, updated_at)
SELECT
  fdo.id,
  f.id || '-sf',
  fdo.date,
  fdo.override_type,
  fdo.start_time,
  fdo.end_time,
  fdo.reason,
  fdo.created_at,
  fdo.updated_at
FROM field_date_overrides fdo
JOIN fields f ON fdo.field_id = f.id;

-- ============================================================
-- STEP 5: Create season_cages table
-- ============================================================

CREATE TABLE season_cages (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  cage_id TEXT NOT NULL,
  division_compatibility TEXT NOT NULL DEFAULT '[]', -- JSON array of division IDs
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (cage_id) REFERENCES batting_cages(id) ON DELETE CASCADE,
  UNIQUE(season_id, cage_id)
);

CREATE INDEX idx_season_cages_season_id ON season_cages(season_id);
CREATE INDEX idx_season_cages_cage_id ON season_cages(cage_id);

-- ============================================================
-- STEP 6: Create new cage_availabilities table with season_cage_id
-- ============================================================

CREATE TABLE cage_availabilities_new (
  id TEXT PRIMARY KEY,
  season_cage_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_cage_id) REFERENCES season_cages(id) ON DELETE CASCADE
);

CREATE INDEX idx_cage_availabilities_season_cage_id ON cage_availabilities_new(season_cage_id);

-- ============================================================
-- STEP 7: Create new cage_date_overrides table with season_cage_id
-- ============================================================

CREATE TABLE cage_date_overrides_new (
  id TEXT PRIMARY KEY,
  season_cage_id TEXT NOT NULL,
  date TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('blackout', 'added')),
  start_time TEXT,
  end_time TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_cage_id) REFERENCES season_cages(id) ON DELETE CASCADE
);

CREATE INDEX idx_cage_date_overrides_new_season_cage_id ON cage_date_overrides_new(season_cage_id);
CREATE INDEX idx_cage_date_overrides_new_date ON cage_date_overrides_new(date);

-- ============================================================
-- STEP 8: Update scheduled_events to reference season_fields/season_cages
-- ============================================================

-- The scheduled_events table currently references field_id and cage_id directly.
-- We need to keep these as they reference the global resource IDs.
-- The season context comes from the game_period_id -> season relationship.
-- No changes needed here.

-- ============================================================
-- STEP 9: Drop old tables and rename new ones
-- ============================================================

-- Drop old availability/override tables
DROP TABLE IF EXISTS field_availabilities;
DROP TABLE IF EXISTS field_date_overrides;
DROP TABLE IF EXISTS cage_availabilities;
DROP TABLE IF EXISTS cage_date_overrides;

-- Drop old field_availability_schedules and field_blackout_dates if they exist
DROP TABLE IF EXISTS field_availability_schedules;
DROP TABLE IF EXISTS field_blackout_dates;

-- Drop the field_division_compatibility junction table (now stored in season_fields)
DROP TABLE IF EXISTS field_division_compatibility;

-- Rename new tables
ALTER TABLE field_availabilities_new RENAME TO field_availabilities;
ALTER TABLE field_date_overrides_new RENAME TO field_date_overrides;
ALTER TABLE cage_availabilities_new RENAME TO cage_availabilities;
ALTER TABLE cage_date_overrides_new RENAME TO cage_date_overrides;

-- Drop old fields table and rename new one
DROP TABLE fields;
ALTER TABLE fields_new RENAME TO fields;

-- ============================================================
-- STEP 10: Remove division_compatibility from batting_cages (now in season_cages)
-- ============================================================

-- SQLite doesn't support DROP COLUMN easily, so we recreate the table
CREATE TABLE batting_cages_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO batting_cages_new (id, name, created_at, updated_at)
SELECT id, name, created_at, updated_at FROM batting_cages;

DROP TABLE batting_cages;
ALTER TABLE batting_cages_new RENAME TO batting_cages;
