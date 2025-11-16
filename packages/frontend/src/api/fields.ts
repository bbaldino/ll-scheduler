import type { Field, CreateFieldInput, UpdateFieldInput } from '@ll-scheduler/shared';

const API_BASE = '/api';

export async function fetchFields(seasonId: string): Promise<Field[]> {
  const response = await fetch(`${API_BASE}/fields?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch fields');
  }
  return response.json();
}

export async function fetchFieldById(id: string): Promise<Field> {
  const response = await fetch(`${API_BASE}/fields/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch field');
  }
  return response.json();
}

export async function createField(input: CreateFieldInput): Promise<Field> {
  const response = await fetch(`${API_BASE}/fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create field');
  }
  return response.json();
}

export async function updateField(id: string, input: UpdateFieldInput): Promise<Field> {
  const response = await fetch(`${API_BASE}/fields/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update field');
  }
  return response.json();
}

export async function deleteField(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/fields/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete field');
  }
}
