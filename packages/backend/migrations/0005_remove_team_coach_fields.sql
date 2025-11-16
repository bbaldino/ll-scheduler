-- Migration: Remove coach fields from teams table
-- Simplifying team model to just name and division

-- Remove coach columns from teams table
ALTER TABLE teams DROP COLUMN coach_name;
ALTER TABLE teams DROP COLUMN coach_email;
ALTER TABLE teams DROP COLUMN coach_phone;
