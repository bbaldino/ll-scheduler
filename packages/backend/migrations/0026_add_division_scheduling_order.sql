-- Add scheduling_order column to divisions table
-- This controls the order in which divisions are scheduled (lower = higher priority)

-- Add the column with a default value of 0
ALTER TABLE divisions ADD COLUMN scheduling_order INTEGER NOT NULL DEFAULT 0;

-- Update existing divisions with sequential order based on alphabetical name
UPDATE divisions SET scheduling_order = (
  SELECT COUNT(*) FROM divisions d2 WHERE d2.name < divisions.name
);
