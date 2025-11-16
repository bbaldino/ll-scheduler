/**
 * Game represents a scheduled game between two teams
 * Games are scoped to a specific season
 */
export interface Game {
  id: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  fieldId: string;
  date: string; // ISO date string
  startTime: string; // HH:MM format (24-hour)
  endTime: string; // HH:MM format (24-hour)
  status: GameStatus;
  homeScore?: number;
  awayScore?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type GameStatus = 'scheduled' | 'cancelled' | 'completed' | 'postponed';

export interface CreateGameInput {
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  fieldId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}

export interface UpdateGameInput {
  homeTeamId?: string;
  awayTeamId?: string;
  fieldId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  status?: GameStatus;
  homeScore?: number;
  awayScore?: number;
  notes?: string;
}
