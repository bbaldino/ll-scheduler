-- Migration: Remove description field from divisions table
-- Since it's not needed

-- Remove description column from divisions table
ALTER TABLE divisions DROP COLUMN description;
