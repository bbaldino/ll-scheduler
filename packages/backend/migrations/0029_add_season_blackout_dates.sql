-- Add blackout_dates column to seasons table
-- Stores JSON array of ISO date strings when no events should be scheduled
ALTER TABLE seasons ADD COLUMN blackout_dates TEXT;
