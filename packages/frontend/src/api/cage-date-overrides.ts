import type {
  CageDateOverride,
  CreateCageDateOverrideInput,
  UpdateCageDateOverrideInput,
} from '@ll-scheduler/shared';

const API_BASE = 'http://localhost:8787/api';

export async function fetchCageDateOverrides(cageId: string): Promise<CageDateOverride[]> {
  const response = await fetch(`${API_BASE}/cage-date-overrides?cageId=${cageId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch cage date overrides');
  }
  return response.json();
}

export async function createCageDateOverride(
  input: CreateCageDateOverrideInput
): Promise<CageDateOverride> {
  const response = await fetch(`${API_BASE}/cage-date-overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create cage date override');
  }
  return response.json();
}

export async function updateCageDateOverride(
  id: string,
  input: UpdateCageDateOverrideInput
): Promise<CageDateOverride> {
  const response = await fetch(`${API_BASE}/cage-date-overrides/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update cage date override');
  }
  return response.json();
}

export async function deleteCageDateOverride(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/cage-date-overrides/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete cage date override');
  }
}
