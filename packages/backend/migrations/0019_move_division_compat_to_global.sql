-- Migration: Move division_compatibility from season tables to global tables
--
-- Division compatibility is a property of the field/cage itself, not season-specific.
-- This migration moves division_compatibility to the global fields and batting_cages tables.

-- ============================================================
-- STEP 1: Add division_compatibility to fields table
-- ============================================================

-- SQLite doesn't support ADD COLUMN with NOT NULL without default, so we recreate
CREATE TABLE fields_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  division_compatibility TEXT NOT NULL DEFAULT '[]', -- JSON array of division IDs
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO fields_new (id, name, division_compatibility, created_at, updated_at)
SELECT id, name, '[]', created_at, updated_at FROM fields;

DROP TABLE fields;
ALTER TABLE fields_new RENAME TO fields;

-- ============================================================
-- STEP 2: Add division_compatibility to batting_cages table
-- ============================================================

CREATE TABLE batting_cages_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  division_compatibility TEXT NOT NULL DEFAULT '[]', -- JSON array of division IDs
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO batting_cages_new (id, name, division_compatibility, created_at, updated_at)
SELECT id, name, '[]', created_at, updated_at FROM batting_cages;

DROP TABLE batting_cages;
ALTER TABLE batting_cages_new RENAME TO batting_cages;

-- ============================================================
-- STEP 3: Remove division_compatibility from season_fields table
-- ============================================================

CREATE TABLE season_fields_new (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE,
  UNIQUE(season_id, field_id)
);

INSERT INTO season_fields_new (id, season_id, field_id, created_at, updated_at)
SELECT id, season_id, field_id, created_at, updated_at FROM season_fields;

DROP TABLE season_fields;
ALTER TABLE season_fields_new RENAME TO season_fields;

CREATE INDEX idx_season_fields_season_id ON season_fields(season_id);
CREATE INDEX idx_season_fields_field_id ON season_fields(field_id);

-- ============================================================
-- STEP 4: Remove division_compatibility from season_cages table
-- ============================================================

CREATE TABLE season_cages_new (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  cage_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (cage_id) REFERENCES batting_cages(id) ON DELETE CASCADE,
  UNIQUE(season_id, cage_id)
);

INSERT INTO season_cages_new (id, season_id, cage_id, created_at, updated_at)
SELECT id, season_id, cage_id, created_at, updated_at FROM season_cages;

DROP TABLE season_cages;
ALTER TABLE season_cages_new RENAME TO season_cages;

CREATE INDEX idx_season_cages_season_id ON season_cages(season_id);
CREATE INDEX idx_season_cages_cage_id ON season_cages(cage_id);
