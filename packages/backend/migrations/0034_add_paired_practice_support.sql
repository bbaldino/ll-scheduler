-- Add columns to scheduled_events for paired practice
-- For paired_practice events, team1_id and team2_id hold the two teams that share the slot
ALTER TABLE scheduled_events ADD COLUMN team1_id TEXT;
ALTER TABLE scheduled_events ADD COLUMN team2_id TEXT;

-- Add columns to division_configs for Sunday paired practice settings
ALTER TABLE division_configs ADD COLUMN sunday_paired_practice_enabled INTEGER DEFAULT 0;
ALTER TABLE division_configs ADD COLUMN sunday_paired_practice_duration_hours REAL;
ALTER TABLE division_configs ADD COLUMN sunday_paired_practice_field_id TEXT;
ALTER TABLE division_configs ADD COLUMN sunday_paired_practice_cage_id TEXT;
