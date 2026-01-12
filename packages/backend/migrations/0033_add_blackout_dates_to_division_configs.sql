-- Add blackout_dates column to division_configs for division-level blackout dates
-- Stores JSON array of { date: string, blockedEventTypes: ('game' | 'practice' | 'cage')[], reason?: string }
ALTER TABLE division_configs ADD COLUMN blackout_dates TEXT;
