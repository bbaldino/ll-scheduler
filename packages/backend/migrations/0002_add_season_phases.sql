-- Create season_phases table
CREATE TABLE season_phases (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phase_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

-- Create index for querying phases by season
CREATE INDEX idx_season_phases_season_id ON season_phases(season_id);
CREATE INDEX idx_season_phases_sort_order ON season_phases(season_id, sort_order);

-- Remove phase column from seasons table
-- SQLite doesn't support DROP COLUMN directly, so we need to:
-- 1. Create a new table without the phase column
-- 2. Copy data from old table to new table
-- 3. Drop old table
-- 4. Rename new table

CREATE TABLE seasons_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy existing data (excluding phase column)
INSERT INTO seasons_new (id, name, start_date, end_date, status, created_at, updated_at)
SELECT id, name, start_date, end_date, status, created_at, updated_at
FROM seasons;

-- Drop old table
DROP TABLE seasons;

-- Rename new table
ALTER TABLE seasons_new RENAME TO seasons;
