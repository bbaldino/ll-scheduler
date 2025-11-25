-- Add cage_session_duration_hours column to division_configs table
ALTER TABLE division_configs ADD COLUMN cage_session_duration_hours REAL;

-- SQLite doesn't support ALTER COLUMN to modify CHECK constraints
-- So we need to recreate the game_periods table to add 'preseason' as a valid period_type

-- Step 1: Create new game_periods table with updated CHECK constraint
CREATE TABLE game_periods_new (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('preseason', 'regular', 'playoffs', 'makeup')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  auto_schedule INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

-- Step 2: Copy data from old table to new table
INSERT INTO game_periods_new (id, season_id, name, period_type, start_date, end_date, description, sort_order, auto_schedule, created_at, updated_at)
SELECT id, season_id, name, period_type, start_date, end_date, description, sort_order, auto_schedule, created_at, updated_at
FROM game_periods;

-- Step 3: Drop old table
DROP TABLE game_periods;

-- Step 4: Rename new table to original name
ALTER TABLE game_periods_new RENAME TO game_periods;

-- Step 5: Recreate indexes
CREATE INDEX idx_game_periods_season_id ON game_periods(season_id);
CREATE INDEX idx_game_periods_sort_order ON game_periods(season_id, sort_order);
