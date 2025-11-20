import type { BattingCage, CreateBattingCageInput, UpdateBattingCageInput } from '@ll-scheduler/shared';

const API_BASE = 'http://localhost:8787/api';

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

export async function updateBattingCage(
  id: string,
  input: UpdateBattingCageInput
): Promise<BattingCage> {
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
