-- Add single_event_only flag to field_availabilities
-- When true, only one event (practice/cage) can be scheduled in this availability window
ALTER TABLE field_availabilities ADD COLUMN single_event_only INTEGER NOT NULL DEFAULT 0;
