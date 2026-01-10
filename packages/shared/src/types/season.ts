/**
 * Season represents a complete season (e.g., Spring 2024, Fall 2024)
 * All other entities are scoped to a specific season.
 *
 * Scheduling model:
 * - Practices and cages can be scheduled from startDate to endDate
 * - Games can only be scheduled from gamesStartDate to endDate
 * - This allows a "preseason" period for practices before games begin
 */
export interface Season {
  id: string;
  name: string;
  startDate: string; // ISO date string - season start (practices/cages begin)
  endDate: string; // ISO date string - season end
  gamesStartDate?: string; // ISO date string - when games can begin (defaults to startDate if not set)
  blackoutDates?: string[]; // ISO date strings - dates when no events should be scheduled
  status: SeasonStatus;
  createdAt: string;
  updatedAt: string;
}

export type SeasonStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface CreateSeasonInput {
  name: string;
  startDate: string;
  endDate: string;
  gamesStartDate?: string;
  blackoutDates?: string[];
  copyFromSeasonId?: string; // Optional: copy configuration from previous season
}

export interface UpdateSeasonInput {
  name?: string;
  startDate?: string;
  endDate?: string;
  gamesStartDate?: string;
  blackoutDates?: string[];
  status?: SeasonStatus;
}

export type EventType = 'game' | 'practice' | 'cage';
