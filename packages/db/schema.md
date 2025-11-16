# Database Schema

## Overview

All entities are scoped to a Season. The schema enforces referential integrity through foreign keys with CASCADE delete operations.

## Tables

### seasons
Top-level entity representing a season (e.g., "Spring 2024")
- `id`: Primary key (UUID)
- `name`: Season name
- `start_date`, `end_date`: ISO date strings
- `phase`: 'regular', 'playoffs', or 'championship'
- `status`: 'draft', 'active', 'completed', or 'archived'

### fields
Physical locations for practices/games (scoped to season)
- `id`: Primary key (UUID)
- `season_id`: Foreign key to seasons
- `name`: Field name
- `location`: Optional address/description

Related tables:
- `field_availability_schedules`: Weekly recurring availability
- `field_blackout_dates`: Specific dates when field is unavailable
- `field_division_compatibility`: Junction table for field-division relationships

### divisions
Age/skill groups (scoped to season)
- `id`: Primary key (UUID)
- `season_id`: Foreign key to seasons
- `name`: Division name (e.g., "T-Ball", "Minors")
- `practices_per_week`, `practice_duration_hours`: Practice requirements
- `games_per_week`, `game_duration_hours`: Game requirements
- `min_consecutive_day_gap`: Minimum days between events for a team

### teams
Individual teams within a division (scoped to season)
- `id`: Primary key (UUID)
- `season_id`: Foreign key to seasons
- `division_id`: Foreign key to divisions
- `name`: Team name
- Coach contact information

### practices
Scheduled practice sessions (scoped to season)
- `id`: Primary key (UUID)
- `season_id`: Foreign key to seasons
- `team_id`: Foreign key to teams
- `field_id`: Foreign key to fields
- `date`, `start_time`, `end_time`: Scheduling information
- `status`: 'scheduled', 'cancelled', or 'completed'

### games
Scheduled games between teams (scoped to season)
- `id`: Primary key (UUID)
- `season_id`: Foreign key to seasons
- `home_team_id`, `away_team_id`: Foreign keys to teams
- `field_id`: Foreign key to fields
- `date`, `start_time`, `end_time`: Scheduling information
- `status`: 'scheduled', 'cancelled', 'completed', or 'postponed'
- `home_score`, `away_score`: Optional scores

## Design Notes

1. **Season-scoping**: All entities reference `season_id`, making it easy to isolate data by season
2. **Cascade deletes**: When a season is deleted, all related data is automatically removed
3. **Separate Practice/Game models**: Different attributes and constraints for each event type
4. **Field availability**: Modeled as recurring weekly schedules plus specific blackout dates
5. **Division compatibility**: Many-to-many relationship between fields and divisions
