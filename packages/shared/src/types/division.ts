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
 * DivisionConfig represents season-specific configuration for a division
 * This allows the same division to have different rules in different seasons
 */
export interface DivisionConfig {
  id: string;
  divisionId: string;
  seasonId: string;
  practicesPerWeek: number;
  practiceDurationHours: number;
  gamesPerWeek?: number;
  gameDurationHours?: number;
  minConsecutiveDayGap?: number; // Minimum days between practices/games for a team
  createdAt: string;
  updatedAt: string;
}

export interface CreateDivisionConfigInput {
  divisionId: string;
  seasonId: string;
  practicesPerWeek: number;
  practiceDurationHours: number;
  gamesPerWeek?: number;
  gameDurationHours?: number;
  minConsecutiveDayGap?: number;
}

export interface UpdateDivisionConfigInput {
  practicesPerWeek?: number;
  practiceDurationHours?: number;
  gamesPerWeek?: number;
  gameDurationHours?: number;
  minConsecutiveDayGap?: number;
}
