import type {
  FieldAvailability,
  CreateFieldAvailabilityInput,
  UpdateFieldAvailabilityInput,
} from '@ll-scheduler/shared';

const API_BASE = 'http://localhost:8787/api';

export async function fetchFieldAvailabilities(fieldId: string): Promise<FieldAvailability[]> {
  const response = await fetch(`${API_BASE}/field-availabilities?fieldId=${fieldId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch field availabilities');
  }
  return response.json();
}

export async function createFieldAvailability(
  input: CreateFieldAvailabilityInput
): Promise<FieldAvailability> {
  const response = await fetch(`${API_BASE}/field-availabilities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create field availability');
  }
  return response.json();
}

export async function updateFieldAvailability(
  id: string,
  input: UpdateFieldAvailabilityInput
): Promise<FieldAvailability> {
  const response = await fetch(`${API_BASE}/field-availabilities/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update field availability');
  }
  return response.json();
}

export async function deleteFieldAvailability(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/field-availabilities/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete field availability');
  }
}
