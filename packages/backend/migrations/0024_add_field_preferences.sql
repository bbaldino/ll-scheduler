-- Add field_preferences column to division_configs table
-- This stores an ordered array of field IDs as JSON (first = most preferred)
ALTER TABLE division_configs ADD COLUMN field_preferences TEXT;

-- Example data format:
-- ["field-uuid-1", "field-uuid-2", "field-uuid-3"]
