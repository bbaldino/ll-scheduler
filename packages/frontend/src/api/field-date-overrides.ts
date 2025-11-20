import type {
  FieldDateOverride,
  CreateFieldDateOverrideInput,
  UpdateFieldDateOverrideInput,
} from '@ll-scheduler/shared';

const API_BASE = 'http://localhost:8787/api';

export async function fetchFieldDateOverrides(fieldId: string): Promise<FieldDateOverride[]> {
  const response = await fetch(`${API_BASE}/field-date-overrides?fieldId=${fieldId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch field date overrides');
  }
  return response.json();
}

export async function createFieldDateOverride(
  input: CreateFieldDateOverrideInput
): Promise<FieldDateOverride> {
  const response = await fetch(`${API_BASE}/field-date-overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create field date override');
  }
  return response.json();
}

export async function updateFieldDateOverride(
  id: string,
  input: UpdateFieldDateOverrideInput
): Promise<FieldDateOverride> {
  const response = await fetch(`${API_BASE}/field-date-overrides/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update field date override');
  }
  return response.json();
}

export async function deleteFieldDateOverride(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/field-date-overrides/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete field date override');
  }
}
