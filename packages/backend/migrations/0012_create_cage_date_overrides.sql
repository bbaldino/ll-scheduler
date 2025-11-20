-- Migration: Create cage_date_overrides table
-- Defines one-off blackout dates or added availability for batting cages

CREATE TABLE cage_date_overrides (
  id TEXT PRIMARY KEY,
  cage_id TEXT NOT NULL,
  date TEXT NOT NULL, -- ISO date YYYY-MM-DD
  override_type TEXT NOT NULL CHECK(override_type IN ('blackout', 'added')),
  start_time TEXT, -- NULL for all-day blackout
  end_time TEXT, -- NULL for all-day blackout
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cage_id) REFERENCES batting_cages(id) ON DELETE CASCADE
);

CREATE INDEX idx_cage_date_overrides_cage_id ON cage_date_overrides(cage_id);
CREATE INDEX idx_cage_date_overrides_date ON cage_date_overrides(date);
