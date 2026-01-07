-- Add game_week_overrides column to division_configs table
-- This stores per-week overrides for games (e.g., partial first week, spring break)
-- Format: JSON array of { weekNumber: number, gamesPerWeek: number }

ALTER TABLE division_configs ADD COLUMN game_week_overrides TEXT DEFAULT '[]';
