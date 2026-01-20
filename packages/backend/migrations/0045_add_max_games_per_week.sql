-- Add max_games_per_week column to division_configs
-- This is a hard cap on games per team per week (including spillover)
ALTER TABLE division_configs ADD COLUMN max_games_per_week INTEGER;
