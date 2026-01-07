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
  gameDayPreferences?: GameDayPreference[]; // Preferred days for game scheduling
  minConsecutiveDayGap?: number; // Minimum days between practices/games for a team
  cageSessionsPerWeek?: number; // Batting cage sessions per week (null = no cage time)
  cageSessionDurationHours?: number; // Duration of cage sessions in hours (default 1)
  fieldPreferences?: string[]; // Ordered list of field IDs, first = most preferred
  gameWeekOverrides?: GameWeekOverride[]; // Per-week game count overrides
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
  gameDayPreferences?: GameDayPreference[];
  minConsecutiveDayGap?: number;
  cageSessionsPerWeek?: number;
  cageSessionDurationHours?: number;
  fieldPreferences?: string[];
  gameWeekOverrides?: GameWeekOverride[];
}

export interface UpdateDivisionConfigInput {
  practicesPerWeek?: number;
  practiceDurationHours?: number;
  gamesPerWeek?: number;
  gameDurationHours?: number;
  gameDayPreferences?: GameDayPreference[];
  minConsecutiveDayGap?: number;
  cageSessionsPerWeek?: number;
  cageSessionDurationHours?: number;
  fieldPreferences?: string[];
  gameWeekOverrides?: GameWeekOverride[];
}
