import type { EventType } from './season.js';

/**
 * Request to generate a schedule for selected season periods
 */
export interface GenerateScheduleRequest {
  periodIds: string[]; // Season periods to generate schedule for
  divisionIds?: string[]; // Optional: only generate for specific divisions
  clearExisting?: boolean; // If true, delete existing events before generating
  maxAttempts?: number; // Maximum number of generation attempts (default: 10)
  scoringWeights?: Partial<ScoringWeights>; // Optional: override default scoring weights
  optimization?: {
    enabled?: boolean; // Enable local search optimization (default: true)
    maxIterations?: number; // Max optimization iterations (default: 100)
  };
  seed?: number; // Optional: seed for reproducible results
}

/**
 * Result of a schedule generation attempt
 */
export interface GenerateScheduleResult {
  success: boolean;
  eventsCreated: number;
  message: string;
  errors?: ScheduleError[];
  warnings?: ScheduleWarning[];
  statistics?: ScheduleStatistics;
  schedulingLog?: SchedulingLogEntry[];
}

/**
 * Log entry for debugging scheduling decisions
 */
export interface SchedulingLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  category: 'game' | 'practice' | 'cage' | 'resource' | 'general';
  message: string;
  details?: {
    teamId?: string;
    teamName?: string;
    divisionId?: string;
    date?: string;
    dayOfWeek?: number;
    resourceId?: string;
    resourceName?: string;
    reason?: string;
    [key: string]: any;
  };
}

/**
 * Error encountered during schedule generation
 */
export interface ScheduleError {
  type: ScheduleErrorType;
  message: string;
  details?: Record<string, any>;
}

export type ScheduleErrorType =
  | 'no_teams'
  | 'no_fields'
  | 'no_cages'
  | 'insufficient_resources'
  | 'invalid_config'
  | 'constraint_violation'
  | 'generation_failed';

/**
 * Warning about potential issues in the generated schedule
 */
export interface ScheduleWarning {
  type: ScheduleWarningType;
  message: string;
  details?: Record<string, any>;
}

export type ScheduleWarningType =
  | 'unbalanced_home_away'
  | 'back_to_back_games'
  | 'limited_time_slots'
  | 'field_overutilization'
  | 'insufficient_resources';

/**
 * Statistics about the generated schedule
 */
export interface ScheduleStatistics {
  totalEvents: number;
  eventsByType: Record<EventType, number>;
  eventsByDivision: Record<string, number>;
  averageEventsPerTeam: number;
  utilizationByField?: Record<string, number>; // Percentage
  utilizationByCage?: Record<string, number>; // Percentage
}

/**
 * Time slot for scheduling
 */
export interface TimeSlot {
  date: string; // ISO date (YYYY-MM-DD)
  dayOfWeek: number; // 0-6
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  duration: number; // hours
}

/**
 * Available resource slot for scheduling
 */
export interface ResourceSlot {
  resourceType: 'field' | 'cage';
  resourceId: string;
  resourceName: string;
  slot: TimeSlot;
}

/**
 * Scheduling constraint for a team
 */
export interface TeamConstraint {
  teamId: string;
  teamName: string;
  divisionId: string;
  requiredGames?: number; // Total games in this phase
  requiredPractices?: number; // Total practices in this phase
  requiredCageSessions?: number; // Total cage sessions in this phase
  minDaysBetweenEvents?: number; // Minimum days between consecutive events
  scheduledEventDates: string[]; // Dates already scheduled (to check gaps)
}

/**
 * Game matchup to be scheduled
 */
export interface GameMatchup {
  homeTeamId: string;
  awayTeamId: string;
  divisionId: string;
}

/**
 * Internal scheduling state used during generation
 */
export interface SchedulingState {
  phase: {
    id: string;
    startDate: string;
    endDate: string;
    allowedEventTypes: EventType[];
  };
  teams: TeamConstraint[];
  resourceSlots: ResourceSlot[];
  scheduledEvents: ScheduledEventDraft[];
  remainingMatchups: GameMatchup[];
  attemptNumber: number;
}

/**
 * Draft of a scheduled event (before saving to database)
 */
export interface ScheduledEventDraft {
  seasonPeriodId: string;
  divisionId: string;
  eventType: EventType;
  date: string;
  startTime: string;
  endTime: string;
  fieldId?: string;
  cageId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  teamId?: string;
}

/**
 * Stored generation log record
 */
export interface ScheduleGenerationLog {
  id: string;
  seasonId: string;
  periodIds: string[];
  success: boolean;
  eventsCreated: number;
  message?: string;
  statistics?: ScheduleStatistics;
  log?: SchedulingLogEntry[];
  errors?: ScheduleError[];
  warnings?: ScheduleWarning[];
  createdAt: string;
}

// ============================================
// Draft-Based Scheduling Types
// ============================================

/**
 * Scoring weights for placement decisions
 *
 * All factors use the pattern: contribution = rawScore × weight
 * - rawScore is 0-1 (continuous) or 0/1 (binary)
 * - Positive weights reward higher rawScores
 * - Negative weights penalize higher rawScores
 */
export interface ScoringWeights {
  // Continuous positive factors (rawScore 0-1, positive weights reward higher scores)
  daySpread: number; // Prefer spreading events across different days of week
  weekBalance: number; // Prefer meeting weekly requirements evenly
  resourceUtilization: number; // Prefer underutilized resources
  gameDayPreference: number; // Match division's preferred game days
  timeQuality: number; // Prefer mid-afternoon times
  homeAwayBalance: number; // For games: balance home/away assignments
  dayGap: number; // Prefer spacing events apart (1 = 2+ day gap, 0.5 = consecutive)

  // Binary penalty factor (rawScore 0 or 1, negative weight penalizes when true)
  sameDayEvent: number; // Penalize when team already has event on this date

  // Continuous penalty factor (rawScore 0-1, negative weight)
  scarcity: number; // Penalize taking slots that are scarce for other teams
}

/**
 * Default scoring weights
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  // Positive factors
  daySpread: 100,
  weekBalance: 100,
  resourceUtilization: 50,
  gameDayPreference: 80,
  timeQuality: 30,
  homeAwayBalance: 70,
  dayGap: 100,

  // Penalty factors
  sameDayEvent: -1000,
  scarcity: -1000,
};

/**
 * A candidate placement for an event
 */
export interface PlacementCandidate {
  eventType: EventType;
  date: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  resourceId: string;
  resourceName: string;
  resourceType: 'field' | 'cage';
  seasonPeriodId: string;
  // For games
  homeTeamId?: string;
  awayTeamId?: string;
  // For practices/cages
  teamId?: string;
}

/**
 * A scored placement candidate
 */
export interface ScoredCandidate extends PlacementCandidate {
  score: number;
  scoreBreakdown?: {
    daySpread: number;
    weekBalance: number;
    resourceUtilization: number;
    gameDayPreference: number;
    timeQuality: number;
    homeAwayBalance: number;
    dayGap: number;
    sameDayEvent: number;
    scarcity: number;
  };
}

/**
 * Team scheduling state during draft allocation
 */
export interface TeamSchedulingState {
  teamId: string;
  teamName: string;
  divisionId: string;
  // Requirements tracking
  totalGamesNeeded: number;
  totalPracticesNeeded: number;
  totalCagesNeeded: number;
  gamesScheduled: number;
  practicesScheduled: number;
  cagesScheduled: number;
  // Per-week tracking
  eventsPerWeek: Map<number, { games: number; practices: number; cages: number }>;
  // Day distribution tracking
  dayOfWeekUsage: Map<number, number>; // dayOfWeek -> count of events
  // Home/away tracking for games
  homeGames: number;
  awayGames: number;
  // Constraint tracking
  datesUsed: Set<string>; // Dates with events scheduled
  minDaysBetweenEvents: number;
}

/**
 * Week definition for scheduling
 */
export interface WeekDefinition {
  weekNumber: number;
  startDate: string; // Monday
  endDate: string; // Sunday
  dates: string[]; // All dates in the week
}

/**
 * Fairness metrics for the generated schedule
 */
export interface FairnessMetrics {
  // Standard deviation of day-of-week usage across teams (lower = more fair)
  dayDistributionStdDev: number;
  // Percentage of teams meeting all weekly requirements
  weeklyRequirementsMet: number;
  // Home/away balance variance across teams (lower = more fair)
  homeAwayVariance: number;
  // Teams with issues
  teamsWithIssues: Array<{
    teamId: string;
    teamName: string;
    issues: string[];
  }>;
}
