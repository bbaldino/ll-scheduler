import type { Season, CreateSeasonInput, UpdateSeasonInput } from '@ll-scheduler/shared';

const API_BASE = '/api';

async function fetchWithRetry(url: string, options?: RequestInit, retries = 3, delay = 500): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      if (i === retries - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries reached');
}

export async function fetchSeasons(): Promise<Season[]> {
  const response = await fetchWithRetry(`${API_BASE}/seasons`);
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
  const response = await fetchWithRetry(`${API_BASE}/seasons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function updateSeason(id: string, input: UpdateSeasonInput): Promise<Season> {
  const response = await fetchWithRetry(`${API_BASE}/seasons/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function deleteSeason(id: string): Promise<void> {
  await fetchWithRetry(`${API_BASE}/seasons/${id}`, {
    method: 'DELETE',
  });
}
