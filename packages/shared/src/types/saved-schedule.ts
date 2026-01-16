/**
 * Saved schedule snapshot - allows users to save and restore schedule states
 */
export interface SavedSchedule {
  id: string;
  seasonId: string;
  name: string;
  description?: string;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating a new saved schedule
 */
export interface CreateSavedScheduleInput {
  seasonId: string;
  name: string;
  description?: string;
}

/**
 * Result of restoring a saved schedule
 */
export interface RestoreScheduleResult {
  restoredCount: number;
  deletedCount: number;
}
