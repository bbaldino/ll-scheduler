-- Add practice_only flag to fields
-- When true, the field can only be used for practices, not games
ALTER TABLE fields ADD COLUMN practice_only INTEGER NOT NULL DEFAULT 0;
