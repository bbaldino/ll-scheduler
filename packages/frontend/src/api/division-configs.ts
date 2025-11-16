import type {
  DivisionConfig,
  CreateDivisionConfigInput,
  UpdateDivisionConfigInput,
} from '@ll-scheduler/shared';

const API_BASE = '/api';

export async function fetchDivisionConfigs(seasonId: string): Promise<DivisionConfig[]> {
  const response = await fetch(`${API_BASE}/division-configs?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch division configs');
  }
  return response.json();
}

export async function fetchDivisionConfigById(id: string): Promise<DivisionConfig> {
  const response = await fetch(`${API_BASE}/division-configs/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch division config');
  }
  return response.json();
}

export async function createDivisionConfig(
  input: CreateDivisionConfigInput
): Promise<DivisionConfig> {
  const response = await fetch(`${API_BASE}/division-configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create division config');
  }
  return response.json();
}

export async function updateDivisionConfig(
  id: string,
  input: UpdateDivisionConfigInput
): Promise<DivisionConfig> {
  const response = await fetch(`${API_BASE}/division-configs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update division config');
  }
  return response.json();
}

export async function deleteDivisionConfig(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/division-configs/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete division config');
  }
}
