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
  seasonId: string;
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

  // Paired practice fields (two teams share field + cage, rotating halves)
  team1Id?: string; // First team in the pair
  team2Id?: string; // Second team in the pair
}

/**
 * Input for creating a new scheduled event
 */
export interface CreateScheduledEventInput {
  seasonId: string;
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
  team1Id?: string;
  team2Id?: string;
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
  team1Id?: string;
  team2Id?: string;
}

/**
 * Query parameters for filtering scheduled events
 */
export interface ScheduledEventQuery {
  seasonId?: string;
  divisionId?: string;
  teamId?: string;
  fieldId?: string;
  cageId?: string;
  eventType?: EventType;
  status?: EventStatus;
  startDate?: string; // ISO date for range queries
  endDate?: string; // ISO date for range queries
}
