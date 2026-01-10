-- Add maxGamesPerSeason column to division_configs
-- This limits the total number of games per team for the season
ALTER TABLE division_configs ADD COLUMN max_games_per_season INTEGER;
