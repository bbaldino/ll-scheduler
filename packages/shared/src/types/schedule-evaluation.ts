import type { GameDayPreference } from './division.js';

/**
 * Schedule Evaluation Types
 * Used to validate generated schedules against constraints and fairness requirements
 */

// Main evaluation result
export interface ScheduleEvaluationResult {
  overallScore: number; // 0-100 percentage of checks passed
  timestamp: string;
  seasonId: string; // Which season was evaluated

  weeklyRequirements: WeeklyRequirementsReport;
  homeAwayBalance: HomeAwayBalanceReport;
  constraintViolations: ConstraintViolationsReport;
  gameDayPreferences: GameDayPreferencesReport;
  gameSpacing: GameSpacingReport;
  matchupBalance: MatchupBalanceReport;
  gameSlotEfficiency: GameSlotEfficiencyReport;
}

// Weekly Requirements Report
export interface WeeklyRequirementsReport {
  passed: boolean;
  summary: string;
  teamReports: TeamWeeklyReport[];
}

export interface TeamWeeklyReport {
  teamId: string;
  teamName: string;
  divisionId: string;
  divisionName: string;
  weeks: WeekSummary[];
  issues: string[]; // e.g., "Week 3: Only 1 game scheduled (required: 2)"
  passed: boolean;
}

export interface WeekSummary {
  weekStart: string; // ISO date string (Monday of the week)
  weekEnd: string; // ISO date string (Sunday of the week)
  gamesScheduled: number;
  gamesRequired: number;
  practicesScheduled: number;
  practicesRequired: number;
  cagesScheduled: number;
  cagesRequired: number;
}

// Home/Away Balance Report
export interface HomeAwayBalanceReport {
  passed: boolean;
  summary: string;
  teamReports: TeamHomeAwayReport[];
}

export interface TeamHomeAwayReport {
  teamId: string;
  teamName: string;
  divisionId: string;
  divisionName: string;
  homeGames: number;
  awayGames: number;
  totalGames: number;
  balance: number; // Absolute difference from ideal (0 = perfect)
  passed: boolean; // Within acceptable threshold (e.g., ±1 game)
}

// Constraint Violations Report
export interface ConstraintViolationsReport {
  passed: boolean;
  summary: string;
  violations: ConstraintViolation[];
}

export type ConstraintViolationType =
  | 'same_day_conflict'
  | 'min_day_gap'
  | 'resource_conflict'
  | 'invalid_event_type_for_period';

export interface ConstraintViolation {
  type: ConstraintViolationType;
  severity: 'error' | 'warning';
  teamId?: string;
  teamName?: string;
  divisionId?: string;
  divisionName?: string;
  date: string;
  description: string;
  eventIds: string[];
}

// Game Day Preferences Report
export interface GameDayPreferencesReport {
  passed: boolean;
  summary: string;
  divisionReports: DivisionGameDayReport[];
}

export interface DivisionGameDayReport {
  divisionId: string;
  divisionName: string;
  preferences: GameDayPreference[];
  actualDistribution: Record<number, number>; // dayOfWeek (0-6) -> game count (total for division)
  teamDistributions: TeamGameDayDistribution[]; // Per-team breakdown
  issues: string[]; // e.g., "3 games on Monday (should avoid)"
  complianceRate: number; // 0-100%
  passed: boolean;
}

export interface TeamGameDayDistribution {
  teamId: string;
  teamName: string;
  distribution: Record<number, number>; // dayOfWeek (0-6) -> game count for this team
  totalGames: number;
}

// Game Spacing Report - tracks days between games for each team
export interface GameSpacingReport {
  passed: boolean;
  summary: string;
  teamReports: TeamGameSpacingReport[];
  overallAverageDaysBetweenGames: number;
}

export interface TeamGameSpacingReport {
  teamId: string;
  teamName: string;
  divisionId: string;
  divisionName: string;
  totalGames: number;
  averageDaysBetweenGames: number; // Average days between consecutive games
  minDaysBetweenGames: number; // Minimum gap found
  maxDaysBetweenGames: number; // Maximum gap found
  gameGaps: number[]; // Array of days between each consecutive game pair
  passed: boolean;
}

// Matchup Balance Report - tracks how many times each team plays each other team
export interface MatchupBalanceReport {
  passed: boolean;
  summary: string;
  divisionReports: DivisionMatchupReport[];
}

export interface DivisionMatchupReport {
  divisionId: string;
  divisionName: string;
  teamMatchups: TeamMatchupReport[];
  idealGamesPerMatchup: number; // Expected games between any two teams
  maxImbalance: number; // Largest difference from ideal across all matchups
  passed: boolean;
}

export interface TeamMatchupReport {
  teamId: string;
  teamName: string;
  opponents: OpponentMatchup[];
  totalGames: number;
}

export interface OpponentMatchup {
  opponentId: string;
  opponentName: string;
  gamesPlayed: number;
  homeGames: number; // Games where this team was home
  awayGames: number; // Games where this team was away
}

// Game Slot Efficiency Report - tracks time slots with single vs multiple concurrent games
export interface GameSlotEfficiencyReport {
  passed: boolean;
  summary: string;
  totalGameSlots: number; // Total number of unique time slots with games
  isolatedSlots: number; // Time slots with only 1 game
  concurrentSlots: number; // Time slots with 2+ games
  efficiencyRate: number; // Percentage of slots that have multiple games (0-100)
  isolatedSlotDetails: IsolatedGameSlot[]; // Details of each isolated game slot
}

export interface IsolatedGameSlot {
  date: string;
  startTime: string;
  endTime: string;
  fieldId: string;
  fieldName: string;
  homeTeamName: string;
  awayTeamName: string;
  divisionName: string;
}

// Request type for evaluate endpoint
export interface EvaluateScheduleRequest {
  seasonId: string;
}
