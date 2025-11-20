-- Migration: Create field_date_overrides table
-- Defines one-off blackout dates or added availability for fields

CREATE TABLE field_date_overrides (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  date TEXT NOT NULL, -- ISO date YYYY-MM-DD
  override_type TEXT NOT NULL CHECK(override_type IN ('blackout', 'added')),
  start_time TEXT, -- NULL for all-day blackout
  end_time TEXT, -- NULL for all-day blackout
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
);

CREATE INDEX idx_field_date_overrides_field_id ON field_date_overrides(field_id);
CREATE INDEX idx_field_date_overrides_date ON field_date_overrides(date);
