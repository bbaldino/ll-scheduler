import type { SeasonPhase, CreateSeasonPhaseInput, UpdateSeasonPhaseInput } from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface SeasonPhaseRow {
  id: string;
  season_id: string;
  name: string;
  phase_type: string;
  start_date: string;
  end_date: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToSeasonPhase(row: SeasonPhaseRow): SeasonPhase {
  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    phaseType: row.phase_type as any,
    startDate: row.start_date,
    endDate: row.end_date,
    description: row.description || undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSeasonPhases(db: D1Database, seasonId: string): Promise<SeasonPhase[]> {
  const result = await db
    .prepare('SELECT * FROM season_phases WHERE season_id = ? ORDER BY sort_order, start_date')
    .bind(seasonId)
    .all<SeasonPhaseRow>();

  return (result.results || []).map(rowToSeasonPhase);
}

export async function getSeasonPhaseById(db: D1Database, id: string): Promise<SeasonPhase | null> {
  const result = await db
    .prepare('SELECT * FROM season_phases WHERE id = ?')
    .bind(id)
    .first<SeasonPhaseRow>();

  return result ? rowToSeasonPhase(result) : null;
}

export async function createSeasonPhase(
  db: D1Database,
  input: CreateSeasonPhaseInput
): Promise<SeasonPhase> {
  const id = generateId();
  const now = new Date().toISOString();
  const sortOrder = input.sortOrder ?? 0;

  await db
    .prepare(
      `INSERT INTO season_phases (id, season_id, name, phase_type, start_date, end_date, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.seasonId,
      input.name,
      input.phaseType,
      input.startDate,
      input.endDate,
      input.description || null,
      sortOrder,
      now,
      now
    )
    .run();

  const phase = await getSeasonPhaseById(db, id);
  if (!phase) {
    throw new Error('Failed to create season phase');
  }

  return phase;
}

export async function updateSeasonPhase(
  db: D1Database,
  id: string,
  input: UpdateSeasonPhaseInput
): Promise<SeasonPhase | null> {
  const existing = await getSeasonPhaseById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.phaseType !== undefined) {
    updates.push('phase_type = ?');
    values.push(input.phaseType);
  }
  if (input.startDate !== undefined) {
    updates.push('start_date = ?');
    values.push(input.startDate);
  }
  if (input.endDate !== undefined) {
    updates.push('end_date = ?');
    values.push(input.endDate);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description);
  }
  if (input.sortOrder !== undefined) {
    updates.push('sort_order = ?');
    values.push(input.sortOrder);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE season_phases SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getSeasonPhaseById(db, id);
}

export async function deleteSeasonPhase(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM season_phases WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
