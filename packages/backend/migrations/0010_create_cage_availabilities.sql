-- Migration: Create cage_availabilities table
-- Defines recurring weekly availability windows for batting cages

CREATE TABLE cage_availabilities (
  id TEXT PRIMARY KEY,
  cage_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
  start_time TEXT NOT NULL, -- HH:MM format
  end_time TEXT NOT NULL, -- HH:MM format
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cage_id) REFERENCES batting_cages(id) ON DELETE CASCADE
);

CREATE INDEX idx_cage_availabilities_cage_id ON cage_availabilities(cage_id);
