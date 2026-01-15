-- Add game_arrive_before_hours to division_configs
-- This represents the time before game start that players should arrive
-- Combined with game_duration_hours, it represents the total time blocked for a game
ALTER TABLE division_configs ADD COLUMN game_arrive_before_hours REAL DEFAULT 0;
