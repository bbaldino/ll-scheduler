import type {
  SeasonPeriod,
  CreateSeasonPeriodInput,
  UpdateSeasonPeriodInput,
} from '@ll-scheduler/shared';

const API_BASE = 'http://localhost:8787/api';

export async function fetchSeasonPeriods(seasonId: string): Promise<SeasonPeriod[]> {
  const response = await fetch(`${API_BASE}/season-periods?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season periods');
  }
  return response.json();
}

export async function fetchSeasonPeriodById(id: string): Promise<SeasonPeriod> {
  const response = await fetch(`${API_BASE}/season-periods/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season period');
  }
  return response.json();
}

export async function createSeasonPeriod(input: CreateSeasonPeriodInput): Promise<SeasonPeriod> {
  const response = await fetch(`${API_BASE}/season-periods`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create season period');
  }
  return response.json();
}

export async function updateSeasonPeriod(
  id: string,
  input: UpdateSeasonPeriodInput
): Promise<SeasonPeriod> {
  const response = await fetch(`${API_BASE}/season-periods/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update season period');
  }
  return response.json();
}

export async function deleteSeasonPeriod(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/season-periods/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete season period');
  }
}
