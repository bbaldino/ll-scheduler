/**
 * Season-level blackout date or date range
 * Blocks specified event types (or all types if blockedEventTypes is not set) on the specified date(s)
 * Can apply to all divisions (default) or specific divisions
 */
export interface SeasonBlackout {
  date: string; // Start date (ISO date YYYY-MM-DD)
  endDate?: string; // End date for range (ISO date YYYY-MM-DD, inclusive). If not set, it's a single date.
  blockedEventTypes?: EventType[]; // Which event types to block (if not set, blocks all types)
  divisionIds?: string[]; // Which divisions this applies to (if not set or empty, applies to ALL divisions)
  reason?: string; // Optional reason (e.g., "Easter", "Spring break")
}

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
  blackoutDates?: SeasonBlackout[]; // Dates when no events should be scheduled
  weekdayPracticeStartTime?: string; // Earliest practice start time on weekdays (HH:MM), e.g., "16:30"
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
  blackoutDates?: SeasonBlackout[];
  weekdayPracticeStartTime?: string;
  copyFromSeasonId?: string; // Optional: copy configuration from previous season
}

export interface UpdateSeasonInput {
  name?: string;
  startDate?: string;
  endDate?: string;
  gamesStartDate?: string;
  blackoutDates?: SeasonBlackout[];
  weekdayPracticeStartTime?: string;
  status?: SeasonStatus;
}

export type EventType = 'game' | 'practice' | 'cage';
