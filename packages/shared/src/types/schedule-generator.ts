import type { EventType } from './season.js';

/**
 * Request to generate a schedule for a season
 */
export interface GenerateScheduleRequest {
  seasonId: string; // Season to generate schedule for
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
  /** Human-readable summary explaining the situation in plain language */
  summary?: string;
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
  /** Human-readable summary explaining the error in plain language */
  summary?: string;
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
  /** Human-readable summary explaining the warning in plain language */
  summary?: string;
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
  season: {
    id: string;
    startDate: string;
    endDate: string;
    gamesStartDate: string; // Games can only be scheduled from this date
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
  seasonId: string;
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
  timeQuality: number; // Prefer mid-afternoon times (for practices)
  homeAwayBalance: number; // For games: balance home/away assignments across season
  matchupHomeAwayBalance: number; // For games: balance home/away within each specific matchup
  dayGap: number; // Prefer spacing events apart (1 = 2+ day gap, 0.5 = consecutive)
  timeAdjacency: number; // Prefer slots adjacent to existing events (pack events together)
  earliestTime: number; // For games: prefer earlier start times
  fieldPreference: number; // Prefer division's preferred fields (1 = most preferred, 0 = not in list)

  // Binary penalty factor (rawScore 0 or 1, negative weight penalizes when true)
  sameDayEvent: number; // Penalize when team already has same-type event on this date

  // Continuous penalty factor (rawScore 0-1, negative weight)
  scarcity: number; // Penalize taking slots that are scarce for other teams
  sameDayCageFieldGap: number; // Penalize non-adjacent cage+field events on same day
  weekendMorningPractice: number; // Penalize practices on weekend mornings (games should get priority)
  shortRestBalance: number; // For games: penalize short rest when team already has more than division average
}

/**
 * Default scoring weights
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  // Positive factors
  daySpread: 100,
  weekBalance: 100,
  resourceUtilization: 50,
  gameDayPreference: 1000, // Very high weight so required days strongly dominate day selection
  timeQuality: 30,
  homeAwayBalance: 70,
  matchupHomeAwayBalance: 150, // Strong preference for balanced home/away within each matchup
  dayGap: 100,
  timeAdjacency: 150, // Strong preference for packing events together
  earliestTime: 200, // Strong preference for earlier game times
  fieldPreference: 300, // Strong preference for division's preferred fields

  // Penalty factors
  sameDayEvent: -1000000, // Effectively a hard constraint - teams can't have two field events on same day
  scarcity: -1000,
  sameDayCageFieldGap: -1000, // Strong penalty for non-adjacent cage+field on same day
  weekendMorningPractice: -500, // Penalty for practices on weekend mornings (reserve for games)
  shortRestBalance: -500, // Strong penalty for short rest when team already has more than average
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
  seasonId: string;
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
    timeAdjacency: number;
    earliestTime: number;
    fieldPreference: number;
    sameDayEvent: number;
    scarcity: number;
    sameDayCageFieldGap: number;
    weekendMorningPractice: number;
    shortRestBalance: number;
  };
}

/**
 * Team scheduling state during draft allocation
 */
export interface TeamSchedulingState {
  teamId: string;
  teamName: string;
  divisionId: string;
  divisionName: string;
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
  // Per-opponent home/away tracking: opponentId -> { home: number, away: number }
  matchupHomeAway: Map<string, { home: number; away: number }>;
  // Constraint tracking - separate field and cage dates since cage + field on same day is OK
  fieldDatesUsed: Set<string>; // Dates with field events (games/practices) scheduled
  cageDatesUsed: Set<string>; // Dates with cage events scheduled
  minDaysBetweenEvents: number;
  // Game-specific tracking for short rest balancing
  gameDates: string[]; // Sorted list of dates when games are scheduled
  shortRestGamesCount: number; // Count of games scheduled ≤2 days after previous game
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
