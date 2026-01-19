-- Add practice_arrive_before_minutes to division_configs
-- This represents the time before practice start that players should arrive (in minutes)

ALTER TABLE division_configs ADD COLUMN practice_arrive_before_minutes INTEGER DEFAULT 10;
