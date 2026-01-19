import type {
  SavedSchedule,
  CreateSavedScheduleInput,
  UpdateSavedScheduleInput,
  RestoreScheduleResult,
} from '@ll-scheduler/shared';
import { API_BASE } from './config';

/**
 * Fetch all saved schedules for a season
 */
export async function fetchSavedSchedules(seasonId: string): Promise<SavedSchedule[]> {
  const response = await fetch(`${API_BASE}/saved-schedules?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch saved schedules');
  }
  return response.json();
}

/**
 * Fetch a specific saved schedule by ID
 */
export async function fetchSavedScheduleById(id: string): Promise<SavedSchedule> {
  const response = await fetch(`${API_BASE}/saved-schedules/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch saved schedule');
  }
  return response.json();
}

/**
 * Save the current schedule
 */
export async function saveSchedule(input: CreateSavedScheduleInput): Promise<SavedSchedule> {
  const response = await fetch(`${API_BASE}/saved-schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to save schedule');
  }
  return response.json();
}

/**
 * Update an existing saved schedule (overwrites with current events)
 */
export async function updateSavedSchedule(
  id: string,
  input: UpdateSavedScheduleInput
): Promise<SavedSchedule> {
  const response = await fetch(`${API_BASE}/saved-schedules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update saved schedule');
  }
  return response.json();
}

/**
 * Restore a saved schedule (replaces current events)
 */
export async function restoreSchedule(savedScheduleId: string): Promise<RestoreScheduleResult> {
  const response = await fetch(`${API_BASE}/saved-schedules/${savedScheduleId}/restore`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to restore schedule');
  }
  return response.json();
}

/**
 * Delete a saved schedule
 */
export async function deleteSavedSchedule(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/saved-schedules/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete saved schedule');
  }
}
