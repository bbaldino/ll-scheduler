-- Remove practice and cage date columns from seasons table
-- These dates are no longer needed as practices and cages use the main season dates

-- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
-- Create new table without the practice/cage date columns
CREATE TABLE seasons_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Copy data from old table
INSERT INTO seasons_new (id, name, start_date, end_date, status, created_at, updated_at)
SELECT id, name, start_date, end_date, status, created_at, updated_at
FROM seasons;

-- Drop old table
DROP TABLE seasons;

-- Rename new table
ALTER TABLE seasons_new RENAME TO seasons;
