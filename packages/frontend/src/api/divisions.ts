import type { Division, CreateDivisionInput, UpdateDivisionInput } from '@ll-scheduler/shared';
import { API_BASE } from './config';

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

export async function fetchDivisions(): Promise<Division[]> {
  const response = await fetchWithRetry(`${API_BASE}/divisions`);
  return response.json();
}

export async function fetchDivisionById(id: string): Promise<Division> {
  const response = await fetch(`${API_BASE}/divisions/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch division');
  }
  return response.json();
}

export async function createDivision(input: CreateDivisionInput): Promise<Division> {
  const response = await fetchWithRetry(`${API_BASE}/divisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function updateDivision(id: string, input: UpdateDivisionInput): Promise<Division> {
  const response = await fetchWithRetry(`${API_BASE}/divisions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function deleteDivision(id: string): Promise<void> {
  await fetchWithRetry(`${API_BASE}/divisions/${id}`, {
    method: 'DELETE',
  });
}

export async function reorderDivisions(divisionIds: string[]): Promise<Division[]> {
  const response = await fetchWithRetry(`${API_BASE}/divisions/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ divisionIds }),
  });
  return response.json();
}
