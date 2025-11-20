import type { EventType } from './season.js';

/**
 * Status of a scheduled event
 */
export type EventStatus = 'scheduled' | 'completed' | 'cancelled' | 'postponed';

/**
 * Base interface for all scheduled events
 */
export interface ScheduledEvent {
  id: string;
  seasonPhaseId: string;
  divisionId: string;
  eventType: EventType;
  date: string; // ISO date (YYYY-MM-DD)
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  status: EventStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;

  // Resource assignment (field or cage)
  fieldId?: string; // For games and practices
  cageId?: string; // For cage sessions

  // Game-specific fields
  homeTeamId?: string;
  awayTeamId?: string;

  // Practice and cage-specific fields
  teamId?: string; // Single team for practices and cage sessions
}

/**
 * Input for creating a new scheduled event
 */
export interface CreateScheduledEventInput {
  seasonPhaseId: string;
  divisionId: string;
  eventType: EventType;
  date: string;
  startTime: string;
  endTime: string;
  status?: EventStatus; // Defaults to 'scheduled'
  notes?: string;
  fieldId?: string;
  cageId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  teamId?: string;
}

/**
 * Input for updating an existing scheduled event
 */
export interface UpdateScheduledEventInput {
  date?: string;
  startTime?: string;
  endTime?: string;
  status?: EventStatus;
  notes?: string;
  fieldId?: string;
  cageId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  teamId?: string;
}

/**
 * Query parameters for filtering scheduled events
 */
export interface ScheduledEventQuery {
  seasonPhaseId?: string;
  divisionId?: string;
  teamId?: string;
  fieldId?: string;
  cageId?: string;
  eventType?: EventType;
  status?: EventStatus;
  startDate?: string; // ISO date for range queries
  endDate?: string; // ISO date for range queries
}
