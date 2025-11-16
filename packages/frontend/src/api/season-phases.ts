import type {
  SeasonPhase,
  CreateSeasonPhaseInput,
  UpdateSeasonPhaseInput,
} from '@ll-scheduler/shared';

const API_BASE = '/api';

export async function fetchSeasonPhases(seasonId: string): Promise<SeasonPhase[]> {
  const response = await fetch(`${API_BASE}/season-phases?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season phases');
  }
  return response.json();
}

export async function fetchSeasonPhaseById(id: string): Promise<SeasonPhase> {
  const response = await fetch(`${API_BASE}/season-phases/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season phase');
  }
  return response.json();
}

export async function createSeasonPhase(input: CreateSeasonPhaseInput): Promise<SeasonPhase> {
  const response = await fetch(`${API_BASE}/season-phases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create season phase');
  }
  return response.json();
}

export async function updateSeasonPhase(
  id: string,
  input: UpdateSeasonPhaseInput
): Promise<SeasonPhase> {
  const response = await fetch(`${API_BASE}/season-phases/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update season phase');
  }
  return response.json();
}

export async function deleteSeasonPhase(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/season-phases/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete season phase');
  }
}
