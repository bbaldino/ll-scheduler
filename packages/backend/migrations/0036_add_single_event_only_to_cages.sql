-- Add single_event_only column to cage_availabilities
ALTER TABLE cage_availabilities ADD COLUMN single_event_only INTEGER DEFAULT 0;

-- Add single_event_only column to cage_date_overrides
ALTER TABLE cage_date_overrides ADD COLUMN single_event_only INTEGER DEFAULT 0;
