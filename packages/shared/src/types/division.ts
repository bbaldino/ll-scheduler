/**
 * Division represents an age or skill group (e.g., T-Ball, Minors, Majors)
 * Divisions are global and exist across all seasons
 */
export interface Division {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDivisionInput {
  name: string;
}

export interface UpdateDivisionInput {
  name?: string;
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
}
