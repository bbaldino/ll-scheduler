import type {
  CageAvailability,
  CreateCageAvailabilityInput,
  UpdateCageAvailabilityInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface CageAvailabilityRow {
  id: string;
  cage_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

function rowToCageAvailability(row: CageAvailabilityRow): CageAvailability {
  return {
    id: row.id,
    cageId: row.cage_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCageAvailabilities(
  db: D1Database,
  cageId: string
): Promise<CageAvailability[]> {
  const result = await db
    .prepare('SELECT * FROM cage_availabilities WHERE cage_id = ? ORDER BY day_of_week, start_time')
    .bind(cageId)
    .all<CageAvailabilityRow>();

  return (result.results || []).map(rowToCageAvailability);
}

export async function getCageAvailabilityById(
  db: D1Database,
  id: string
): Promise<CageAvailability | null> {
  const result = await db
    .prepare('SELECT * FROM cage_availabilities WHERE id = ?')
    .bind(id)
    .first<CageAvailabilityRow>();

  return result ? rowToCageAvailability(result) : null;
}

export async function createCageAvailability(
  db: D1Database,
  input: CreateCageAvailabilityInput
): Promise<CageAvailability> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO cage_availabilities (id, cage_id, day_of_week, start_time, end_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.cageId, input.dayOfWeek, input.startTime, input.endTime, now, now)
    .run();

  const availability = await getCageAvailabilityById(db, id);
  if (!availability) {
    throw new Error('Failed to create cage availability');
  }

  return availability;
}

export async function updateCageAvailability(
  db: D1Database,
  id: string,
  input: UpdateCageAvailabilityInput
): Promise<CageAvailability | null> {
  const existing = await getCageAvailabilityById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.dayOfWeek !== undefined) {
    updates.push('day_of_week = ?');
    values.push(input.dayOfWeek);
  }
  if (input.startTime !== undefined) {
    updates.push('start_time = ?');
    values.push(input.startTime);
  }
  if (input.endTime !== undefined) {
    updates.push('end_time = ?');
    values.push(input.endTime);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE cage_availabilities SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getCageAvailabilityById(db, id);
}

export async function deleteCageAvailability(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM cage_availabilities WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
