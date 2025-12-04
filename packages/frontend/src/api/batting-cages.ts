import type {
  BattingCage,
  CreateBattingCageInput,
  UpdateBattingCageInput,
  SeasonCage,
  CreateSeasonCageInput,
  UpdateSeasonCageInput,
  CageAvailability,
  CreateCageAvailabilityInput,
  UpdateCageAvailabilityInput,
  CageDateOverride,
  CreateCageDateOverrideInput,
  UpdateCageDateOverrideInput,
} from '@ll-scheduler/shared';
import { API_BASE } from './config';

// ============================================================
// Global Batting Cages API
// ============================================================

export async function fetchBattingCages(): Promise<BattingCage[]> {
  const response = await fetch(`${API_BASE}/batting-cages`);
  if (!response.ok) {
    throw new Error('Failed to fetch batting cages');
  }
  return response.json();
}

export async function fetchBattingCageById(id: string): Promise<BattingCage> {
  const response = await fetch(`${API_BASE}/batting-cages/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch batting cage');
  }
  return response.json();
}

export async function createBattingCage(input: CreateBattingCageInput): Promise<BattingCage> {
  const response = await fetch(`${API_BASE}/batting-cages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create batting cage');
  }
  return response.json();
}

export async function updateBattingCage(id: string, input: UpdateBattingCageInput): Promise<BattingCage> {
  const response = await fetch(`${API_BASE}/batting-cages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update batting cage');
  }
  return response.json();
}

export async function deleteBattingCage(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/batting-cages/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete batting cage');
  }
}

// ============================================================
// Season Cages API (cages linked to a season)
// ============================================================

export async function fetchSeasonCages(seasonId: string): Promise<SeasonCage[]> {
  const response = await fetch(`${API_BASE}/season-cages?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season cages');
  }
  return response.json();
}

export async function fetchSeasonCageById(id: string): Promise<SeasonCage> {
  const response = await fetch(`${API_BASE}/season-cages/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch season cage');
  }
  return response.json();
}

export async function createSeasonCage(input: CreateSeasonCageInput): Promise<SeasonCage> {
  const response = await fetch(`${API_BASE}/season-cages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create season cage');
  }
  return response.json();
}

export async function updateSeasonCage(id: string, input: UpdateSeasonCageInput): Promise<SeasonCage> {
  const response = await fetch(`${API_BASE}/season-cages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update season cage');
  }
  return response.json();
}

export async function deleteSeasonCage(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/season-cages/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete season cage');
  }
}

// ============================================================
// Cage Availabilities API (tied to season cages)
// ============================================================

export async function fetchCageAvailabilities(seasonCageId: string): Promise<CageAvailability[]> {
  const response = await fetch(`${API_BASE}/cage-availabilities?seasonCageId=${seasonCageId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch cage availabilities');
  }
  return response.json();
}

export async function createCageAvailability(input: CreateCageAvailabilityInput): Promise<CageAvailability> {
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

export async function updateCageAvailability(id: string, input: UpdateCageAvailabilityInput): Promise<CageAvailability> {
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

// ============================================================
// Cage Date Overrides API (tied to season cages)
// ============================================================

export async function fetchCageDateOverrides(seasonCageId: string): Promise<CageDateOverride[]> {
  const response = await fetch(`${API_BASE}/cage-date-overrides?seasonCageId=${seasonCageId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch cage date overrides');
  }
  return response.json();
}

export async function createCageDateOverride(input: CreateCageDateOverrideInput): Promise<CageDateOverride> {
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

export async function updateCageDateOverride(id: string, input: UpdateCageDateOverrideInput): Promise<CageDateOverride> {
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
