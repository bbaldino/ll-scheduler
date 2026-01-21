-- Add weekday practice start time configuration
-- This allows setting the earliest time practices can start on weekdays (Mon-Fri)
-- Season level provides the default, division level can override

-- Add to seasons table (default for all divisions in the season)
ALTER TABLE seasons ADD COLUMN weekday_practice_start_time TEXT;

-- Add to division_configs table (optional override per division)
ALTER TABLE division_configs ADD COLUMN weekday_practice_start_time TEXT;
