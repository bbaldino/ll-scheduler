import type { Season, CreateSeasonInput, UpdateSeasonInput } from '@ll-scheduler/shared';

const API_BASE = '/api';

export async function fetchSeasons(): Promise<Season[]> {
  const response = await fetch(`${API_BASE}/seasons`);
  if (!response.ok) {
    throw new Error('Failed to fetch seasons');
  }
  return response.json();
}

export async function fetchSeasonById(id: string): Promise<Season> {
  const response = await fetch(`${API_BASE}/seasons/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season');
  }
  return response.json();
}

export async function createSeason(input: CreateSeasonInput): Promise<Season> {
  const response = await fetch(`${API_BASE}/seasons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create season');
  }
  return response.json();
}

export async function updateSeason(id: string, input: UpdateSeasonInput): Promise<Season> {
  const response = await fetch(`${API_BASE}/seasons/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update season');
  }
  return response.json();
}

export async function deleteSeason(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/seasons/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete season');
  }
}
