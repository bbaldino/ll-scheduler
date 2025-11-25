import type { EventType } from './season.js';

/**
 * Request to generate a schedule for selected season periods
 */
export interface GenerateScheduleRequest {
  periodIds: string[]; // Season periods to generate schedule for
  divisionIds?: string[]; // Optional: only generate for specific divisions
  clearExisting?: boolean; // If true, delete existing events before generating
  maxAttempts?: number; // Maximum number of generation attempts (default: 10)
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
