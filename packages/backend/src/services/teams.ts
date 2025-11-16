import type { Team, CreateTeamInput, UpdateTeamInput } from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface TeamRow {
  id: string;
  season_id: string;
  division_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

function rowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    seasonId: row.season_id,
    divisionId: row.division_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTeams(db: D1Database, seasonId: string): Promise<Team[]> {
  const result = await db
    .prepare('SELECT * FROM teams WHERE season_id = ? ORDER BY name')
    .bind(seasonId)
    .all<TeamRow>();

  return (result.results || []).map(rowToTeam);
}

export async function getTeamById(db: D1Database, id: string): Promise<Team | null> {
  const result = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first<TeamRow>();

  return result ? rowToTeam(result) : null;
}

export async function createTeam(db: D1Database, input: CreateTeamInput): Promise<Team> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      'INSERT INTO teams (id, season_id, division_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id, input.seasonId, input.divisionId, input.name, now, now)
    .run();

  const team = await getTeamById(db, id);
  if (!team) {
    throw new Error('Failed to create team');
  }

  return team;
}

export async function updateTeam(
  db: D1Database,
  id: string,
  input: UpdateTeamInput
): Promise<Team | null> {
  const existing = await getTeamById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.divisionId !== undefined) {
    updates.push('division_id = ?');
    values.push(input.divisionId);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getTeamById(db, id);
}

export async function deleteTeam(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();

  return (result.meta.changes ?? 0) > 0;
}
