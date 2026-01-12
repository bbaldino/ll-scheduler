-- Add single_event_only flag to field_date_overrides
-- When true (and override_type is 'added'), only one event can be scheduled on this date
ALTER TABLE field_date_overrides ADD COLUMN single_event_only INTEGER NOT NULL DEFAULT 0;
