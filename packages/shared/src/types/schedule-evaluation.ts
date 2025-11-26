import type { GameDayPreference } from './division.js';

/**
 * Schedule Evaluation Types
 * Used to validate generated schedules against constraints and fairness requirements
 */

// Main evaluation result
export interface ScheduleEvaluationResult {
  overallScore: number; // 0-100 percentage of checks passed
  timestamp: string;
  periodIds: string[]; // Which periods were evaluated

  weeklyRequirements: WeeklyRequirementsReport;
  homeAwayBalance: HomeAwayBalanceReport;
  constraintViolations: ConstraintViolationsReport;
  gameDayPreferences: GameDayPreferencesReport;
  gameSpacing: GameSpacingReport;
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
  actualDistribution: Record<number, number>; // dayOfWeek (0-6) -> game count
  issues: string[]; // e.g., "3 games on Monday (should avoid)"
  complianceRate: number; // 0-100%
  passed: boolean;
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

// Request type for evaluate endpoint
export interface EvaluateScheduleRequest {
  periodIds: string[];
}
