-- Migration: Add cage_sessions_per_week to division_configs
-- Allows divisions to specify how many batting cage sessions teams need per week

ALTER TABLE division_configs ADD COLUMN cage_sessions_per_week INTEGER NULL;
