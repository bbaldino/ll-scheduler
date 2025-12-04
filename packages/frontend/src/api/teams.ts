import type { Team, CreateTeamInput, UpdateTeamInput } from '@ll-scheduler/shared';
import { API_BASE } from './config';

export async function fetchTeams(seasonId: string): Promise<Team[]> {
  const response = await fetch(`${API_BASE}/teams?seasonId=${seasonId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch teams');
  }
  return response.json();
}

export async function fetchTeamById(id: string): Promise<Team> {
  const response = await fetch(`${API_BASE}/teams/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch team');
  }
  return response.json();
}

export async function createTeam(input: CreateTeamInput): Promise<Team> {
  const response = await fetch(`${API_BASE}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create team');
  }
  return response.json();
}

export async function updateTeam(id: string, input: UpdateTeamInput): Promise<Team> {
  const response = await fetch(`${API_BASE}/teams/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update team');
  }
  return response.json();
}

export async function deleteTeam(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/teams/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete team');
  }
}
