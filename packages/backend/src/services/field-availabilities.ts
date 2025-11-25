import type {
  FieldAvailability,
  CreateFieldAvailabilityInput,
  UpdateFieldAvailabilityInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface FieldAvailabilityRow {
  id: string;
  season_field_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

function rowToFieldAvailability(row: FieldAvailabilityRow): FieldAvailability {
  return {
    id: row.id,
    seasonFieldId: row.season_field_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List field availabilities, optionally filtered by season field
 */
export async function listFieldAvailabilities(
  db: D1Database,
  seasonFieldId?: string
): Promise<FieldAvailability[]> {
  let result;
  if (seasonFieldId) {
    result = await db
      .prepare('SELECT * FROM field_availabilities WHERE season_field_id = ? ORDER BY day_of_week, start_time')
      .bind(seasonFieldId)
      .all<FieldAvailabilityRow>();
  } else {
    result = await db
      .prepare('SELECT * FROM field_availabilities ORDER BY day_of_week, start_time')
      .all<FieldAvailabilityRow>();
  }

  return (result.results || []).map(rowToFieldAvailability);
}

/**
 * List all field availabilities for a season (joins through season_fields)
 */
export async function listFieldAvailabilitiesForSeason(
  db: D1Database,
  seasonId: string
): Promise<FieldAvailability[]> {
  const result = await db
    .prepare(`
      SELECT fa.*
      FROM field_availabilities fa
      JOIN season_fields sf ON fa.season_field_id = sf.id
      WHERE sf.season_id = ?
      ORDER BY fa.day_of_week, fa.start_time
    `)
    .bind(seasonId)
    .all<FieldAvailabilityRow>();

  return (result.results || []).map(rowToFieldAvailability);
}

export async function getFieldAvailabilityById(
  db: D1Database,
  id: string
): Promise<FieldAvailability | null> {
  const result = await db
    .prepare('SELECT * FROM field_availabilities WHERE id = ?')
    .bind(id)
    .first<FieldAvailabilityRow>();

  return result ? rowToFieldAvailability(result) : null;
}

export async function createFieldAvailability(
  db: D1Database,
  input: CreateFieldAvailabilityInput
): Promise<FieldAvailability> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO field_availabilities (id, season_field_id, day_of_week, start_time, end_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.seasonFieldId, input.dayOfWeek, input.startTime, input.endTime, now, now)
    .run();

  const availability = await getFieldAvailabilityById(db, id);
  if (!availability) {
    throw new Error('Failed to create field availability');
  }

  return availability;
}

export async function updateFieldAvailability(
  db: D1Database,
  id: string,
  input: UpdateFieldAvailabilityInput
): Promise<FieldAvailability | null> {
  const existing = await getFieldAvailabilityById(db, id);
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
    .prepare(`UPDATE field_availabilities SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getFieldAvailabilityById(db, id);
}

export async function deleteFieldAvailability(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM field_availabilities WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
