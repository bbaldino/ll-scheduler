/**
 * Practice represents a scheduled practice session for a team
 * Practices are scoped to a specific season
 */
export interface Practice {
  id: string;
  seasonId: string;
  teamId: string;
  fieldId: string;
  date: string; // ISO date string
  startTime: string; // HH:MM format (24-hour)
  endTime: string; // HH:MM format (24-hour)
  status: PracticeStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type PracticeStatus = 'scheduled' | 'cancelled' | 'completed';

export interface CreatePracticeInput {
  seasonId: string;
  teamId: string;
  fieldId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}

export interface UpdatePracticeInput {
  fieldId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  status?: PracticeStatus;
  notes?: string;
}
