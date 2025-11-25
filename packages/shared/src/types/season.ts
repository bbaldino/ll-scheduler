/**
 * Season represents a complete season (e.g., Spring 2024, Fall 2024)
 * All other entities are scoped to a specific season.
 * Events are scheduled within SeasonPeriods which define date ranges and allowed event types.
 */
export interface Season {
  id: string;
  name: string;
  startDate: string; // ISO date string - season start (for practices/cages)
  endDate: string; // ISO date string - season end (for practices/cages)
  status: SeasonStatus;
  createdAt: string;
  updatedAt: string;
}

export type SeasonStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface CreateSeasonInput {
  name: string;
  startDate: string;
  endDate: string;
  copyFromSeasonId?: string; // Optional: copy configuration from previous season
}

export interface UpdateSeasonInput {
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: SeasonStatus;
}

export type EventType = 'game' | 'practice' | 'cage';

/**
 * SeasonPeriod represents a distinct period within a season for scheduling specific event types.
 * Periods can overlap to model real-world schedules:
 * - A "Practices & Cages" period might span the full season
 * - A "Regular Season Games" period might start 2 weeks in and end 2 weeks early
 * - A "Makeup Games" period might cover the last 1-2 weeks with autoSchedule=false
 */
export interface SeasonPeriod {
  id: string;
  seasonId: string;
  name: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  eventTypes: EventType[]; // Which event types can be scheduled in this period
  autoSchedule: boolean; // Whether to auto-schedule events in this period (false for makeup/playoffs)
  sortOrder: number; // For ordering periods in the UI
  createdAt: string;
  updatedAt: string;
}

export interface CreateSeasonPeriodInput {
  seasonId: string;
  name: string;
  startDate: string;
  endDate: string;
  eventTypes: EventType[];
  autoSchedule?: boolean; // Defaults to true
  sortOrder?: number;
}

export interface UpdateSeasonPeriodInput {
  name?: string;
  startDate?: string;
  endDate?: string;
  eventTypes?: EventType[];
  autoSchedule?: boolean;
  sortOrder?: number;
}
