-- Migration: Add allowed_event_types to season_phases
-- Allows phases to specify which event types can occur (games, practices, cages)

-- Add allowed_event_types column (JSON array)
ALTER TABLE season_phases ADD COLUMN allowed_event_types TEXT NOT NULL DEFAULT '["game","practice","cage"]';
