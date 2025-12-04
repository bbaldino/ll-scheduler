import type {
  Field,
  CreateFieldInput,
  UpdateFieldInput,
  SeasonField,
  CreateSeasonFieldInput,
  UpdateSeasonFieldInput,
  FieldAvailability,
  CreateFieldAvailabilityInput,
  UpdateFieldAvailabilityInput,
  FieldDateOverride,
  CreateFieldDateOverrideInput,
  UpdateFieldDateOverrideInput,
} from '@ll-scheduler/shared';
import { API_BASE } from './config';

// ============================================================
// Global Fields API
// ============================================================

export async function fetchFields(): Promise<Field[]> {
  const response = await fetch(`${API_BASE}/fields`);
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

// ============================================================
// Season Fields API (fields linked to a season)
// ============================================================

export async function fetchSeasonFields(seasonId: string): Promise<SeasonField[]> {
  const response = await fetch(`${API_BASE}/season-fields?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season fields');
  }
  return response.json();
}

export async function fetchSeasonFieldById(id: string): Promise<SeasonField> {
  const response = await fetch(`${API_BASE}/season-fields/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season field');
  }
  return response.json();
}

export async function createSeasonField(input: CreateSeasonFieldInput): Promise<SeasonField> {
  const response = await fetch(`${API_BASE}/season-fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create season field');
  }
  return response.json();
}

export async function updateSeasonField(id: string, input: UpdateSeasonFieldInput): Promise<SeasonField> {
  const response = await fetch(`${API_BASE}/season-fields/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update season field');
  }
  return response.json();
}

export async function deleteSeasonField(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/season-fields/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete season field');
  }
}

// ============================================================
// Field Availabilities API (tied to season fields)
// ============================================================

export async function fetchFieldAvailabilities(seasonFieldId: string): Promise<FieldAvailability[]> {
  const response = await fetch(`${API_BASE}/field-availabilities?seasonFieldId=${seasonFieldId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch field availabilities');
  }
  return response.json();
}

export async function createFieldAvailability(input: CreateFieldAvailabilityInput): Promise<FieldAvailability> {
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

export async function updateFieldAvailability(id: string, input: UpdateFieldAvailabilityInput): Promise<FieldAvailability> {
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

// ============================================================
// Field Date Overrides API (tied to season fields)
// ============================================================

export async function fetchFieldDateOverrides(seasonFieldId: string): Promise<FieldDateOverride[]> {
  const response = await fetch(`${API_BASE}/field-date-overrides?seasonFieldId=${seasonFieldId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch field date overrides');
  }
  return response.json();
}

export async function createFieldDateOverride(input: CreateFieldDateOverrideInput): Promise<FieldDateOverride> {
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

export async function updateFieldDateOverride(id: string, input: UpdateFieldDateOverrideInput): Promise<FieldDateOverride> {
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
