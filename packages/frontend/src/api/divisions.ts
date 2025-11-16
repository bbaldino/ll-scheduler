import type { Division, CreateDivisionInput, UpdateDivisionInput } from '@ll-scheduler/shared';

const API_BASE = '/api';

export async function fetchDivisions(): Promise<Division[]> {
  const response = await fetch(`${API_BASE}/divisions`);
  if (!response.ok) {
    throw new Error('Failed to fetch divisions');
  }
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
  const response = await fetch(`${API_BASE}/divisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create division');
  }
  return response.json();
}

export async function updateDivision(id: string, input: UpdateDivisionInput): Promise<Division> {
  const response = await fetch(`${API_BASE}/divisions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update division');
  }
  return response.json();
}

export async function deleteDivision(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/divisions/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete division');
  }
}
