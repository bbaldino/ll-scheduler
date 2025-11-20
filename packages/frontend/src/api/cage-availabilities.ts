import type {
  CageAvailability,
  CreateCageAvailabilityInput,
  UpdateCageAvailabilityInput,
} from '@ll-scheduler/shared';

const API_BASE = 'http://localhost:8787/api';

export async function fetchCageAvailabilities(cageId: string): Promise<CageAvailability[]> {
  const response = await fetch(`${API_BASE}/cage-availabilities?cageId=${cageId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch cage availabilities');
  }
  return response.json();
}

export async function createCageAvailability(
  input: CreateCageAvailabilityInput
): Promise<CageAvailability> {
  const response = await fetch(`${API_BASE}/cage-availabilities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create cage availability');
  }
  return response.json();
}

export async function updateCageAvailability(
  id: string,
  input: UpdateCageAvailabilityInput
): Promise<CageAvailability> {
  const response = await fetch(`${API_BASE}/cage-availabilities/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update cage availability');
  }
  return response.json();
}

export async function deleteCageAvailability(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/cage-availabilities/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete cage availability');
  }
}
