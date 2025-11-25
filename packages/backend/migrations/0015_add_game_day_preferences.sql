-- Add game_day_preferences column to division_configs table
-- This stores an array of day-of-week preferences as JSON
ALTER TABLE division_configs ADD COLUMN game_day_preferences TEXT;

-- Example data format:
-- [
--   {"dayOfWeek": 6, "priority": "required", "maxGamesPerDay": 1},
--   {"dayOfWeek": 2, "priority": "preferred"},
--   {"dayOfWeek": 4, "priority": "preferred"}
-- ]
