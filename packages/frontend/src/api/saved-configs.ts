import type {
  SavedConfig,
  CreateSavedConfigInput,
  RestoreConfigResult,
} from '@ll-scheduler/shared';
import { API_BASE } from './config';

/**
 * Fetch all saved configs for a season
 */
export async function fetchSavedConfigs(seasonId: string): Promise<SavedConfig[]> {
  const response = await fetch(`${API_BASE}/saved-configs?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch saved configs');
  }
  return response.json();
}

/**
 * Fetch a specific saved config by ID
 */
export async function fetchSavedConfigById(id: string): Promise<SavedConfig> {
  const response = await fetch(`${API_BASE}/saved-configs/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch saved config');
  }
  return response.json();
}

/**
 * Save the current config
 */
export async function saveConfig(input: CreateSavedConfigInput): Promise<SavedConfig> {
  const response = await fetch(`${API_BASE}/saved-configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to save config');
  }
  return response.json();
}

/**
 * Restore a saved config
 */
export async function restoreConfig(savedConfigId: string): Promise<RestoreConfigResult> {
  const response = await fetch(`${API_BASE}/saved-configs/${savedConfigId}/restore`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to restore config');
  }
  return response.json();
}

/**
 * Delete a saved config
 */
export async function deleteSavedConfig(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/saved-configs/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete saved config');
  }
}
