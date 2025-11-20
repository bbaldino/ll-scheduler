-- Migration: Create batting_cages table
-- Batting cages are resources that teams can reserve for practice time

CREATE TABLE batting_cages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  division_compatibility TEXT NOT NULL DEFAULT '[]', -- JSON array of division IDs
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
