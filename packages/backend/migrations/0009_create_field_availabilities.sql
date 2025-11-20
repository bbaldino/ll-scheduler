-- Migration: Create field_availabilities table
-- Defines recurring weekly availability windows for fields

CREATE TABLE field_availabilities (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
  start_time TEXT NOT NULL, -- HH:MM format
  end_time TEXT NOT NULL, -- HH:MM format
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
);

CREATE INDEX idx_field_availabilities_field_id ON field_availabilities(field_id);
