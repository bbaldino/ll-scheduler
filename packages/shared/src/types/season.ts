/**
 * Season represents a complete season (e.g., Spring 2024, Fall 2024)
 * All other entities are scoped to a specific season
 */
export interface Season {
  id: string;
  name: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
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

/**
 * SeasonPhase represents a distinct period within a season with its own scheduling rules
 * Examples: Regular Season, Makeup Games, Playoffs, Championship
 */
export interface SeasonPhase {
  id: string;
  seasonId: string;
  name: string;
  phaseType: SeasonPhaseType;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  description?: string;
  sortOrder: number; // For ordering phases chronologically
  createdAt: string;
  updatedAt: string;
}

export type SeasonPhaseType = 'regular' | 'makeup' | 'playoffs' | 'championship' | 'other';

export interface CreateSeasonPhaseInput {
  seasonId: string;
  name: string;
  phaseType: SeasonPhaseType;
  startDate: string;
  endDate: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateSeasonPhaseInput {
  name?: string;
  phaseType?: SeasonPhaseType;
  startDate?: string;
  endDate?: string;
  description?: string;
  sortOrder?: number;
}
