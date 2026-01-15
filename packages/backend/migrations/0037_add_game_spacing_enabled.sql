-- Add game_spacing_enabled to division_configs
-- When enabled, the scheduler will apply minimum day gap constraints between games
ALTER TABLE division_configs ADD COLUMN game_spacing_enabled INTEGER DEFAULT 0;
