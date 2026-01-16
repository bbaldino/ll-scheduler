/**
 * Division represents an age or skill group (e.g., T-Ball, Minors, Majors)
 * Divisions are global and exist across all seasons
 */
export interface Division {
  id: string;
  name: string;
  schedulingOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDivisionInput {
  name: string;
}

export interface UpdateDivisionInput {
  name?: string;
  schedulingOrder?: number;
}

/**
 * Day-of-week scheduling preference for games
 */
export interface GameDayPreference {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  priority: 'required' | 'preferred' | 'acceptable' | 'avoid';
  maxGamesPerDay?: number; // Maximum games on this day (e.g., 1 game on Saturday)
}

/**
 * Override for games-per-week in a specific week
 * Used for partial first weeks, spring break, etc.
 */
export interface GameWeekOverride {
  weekNumber: number; // Week number (1-based, from gamesStartDate)
  gamesPerWeek: number; // Number of games for this week (can be 0)
}

/**
 * Division-specific blackout date or date range
 * Allows blocking specific event types on specific dates for a division
 */
export interface DivisionBlackout {
  date: string; // Start date (ISO date YYYY-MM-DD)
  endDate?: string; // End date for range (ISO date YYYY-MM-DD, inclusive). If not set, it's a single date.
  blockedEventTypes: ('game' | 'practice' | 'cage')[]; // Which event types to block
  reason?: string; // Optional reason (e.g., "Easter", "Spring break")
}

/**
 * DivisionConfig represents season-specific configuration for a division
 * This allows the same division to have different rules in different seasons
 */
export interface DivisionConfig {
  id: string;
  divisionId: string;
  seasonId: string;
  practicesPerWeek: number;
  practiceDurationHours: number;
  gamesPerWeek: number;
  gameDurationHours: number;
  gameArriveBeforeHours?: number; // Time before game start players should arrive
  gameDayPreferences?: GameDayPreference[]; // Preferred days for game scheduling
  minConsecutiveDayGap?: number; // Minimum days between practices/games for a team
  cageSessionsPerWeek?: number; // Batting cage sessions per week (null = no cage time)
  cageSessionDurationHours?: number; // Duration of cage sessions in hours (default 1)
  fieldPreferences?: string[]; // Ordered list of field IDs, first = most preferred
  gameWeekOverrides?: GameWeekOverride[]; // Per-week game count overrides
  maxGamesPerSeason?: number; // Maximum total games per team for the season (limits round-robin matchups)
  blackoutDates?: DivisionBlackout[]; // Division-specific blackout dates

  // Sunday paired practice settings
  sundayPairedPracticeEnabled?: boolean; // Enable Sunday paired practice mode
  sundayPairedPracticeDurationHours?: number; // Total duration per pair (both halves)
  sundayPairedPracticeFieldId?: string; // Specific field to use
  sundayPairedPracticeCageId?: string; // Specific cage to use

  // Game spacing settings
  gameSpacingEnabled?: boolean; // Enable game spacing constraints (min days between games)

  createdAt: string;
  updatedAt: string;
}

export interface CreateDivisionConfigInput {
  divisionId: string;
  seasonId: string;
  practicesPerWeek: number;
  practiceDurationHours: number;
  gamesPerWeek: number;
  gameDurationHours: number;
  gameArriveBeforeHours?: number;
  gameDayPreferences?: GameDayPreference[];
  minConsecutiveDayGap?: number;
  cageSessionsPerWeek?: number;
  cageSessionDurationHours?: number;
  fieldPreferences?: string[];
  gameWeekOverrides?: GameWeekOverride[];
  maxGamesPerSeason?: number;
  blackoutDates?: DivisionBlackout[];
  sundayPairedPracticeEnabled?: boolean;
  sundayPairedPracticeDurationHours?: number;
  sundayPairedPracticeFieldId?: string;
  sundayPairedPracticeCageId?: string;
  gameSpacingEnabled?: boolean;
}

export interface UpdateDivisionConfigInput {
  practicesPerWeek?: number;
  practiceDurationHours?: number;
  gamesPerWeek?: number;
  gameDurationHours?: number;
  gameArriveBeforeHours?: number;
  gameDayPreferences?: GameDayPreference[];
  minConsecutiveDayGap?: number;
  cageSessionsPerWeek?: number;
  cageSessionDurationHours?: number;
  fieldPreferences?: string[];
  gameWeekOverrides?: GameWeekOverride[];
  maxGamesPerSeason?: number;
  blackoutDates?: DivisionBlackout[];
  sundayPairedPracticeEnabled?: boolean;
  sundayPairedPracticeDurationHours?: number;
  sundayPairedPracticeFieldId?: string;
  sundayPairedPracticeCageId?: string;
  gameSpacingEnabled?: boolean;
}
