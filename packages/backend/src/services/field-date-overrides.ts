import type {
  FieldDateOverride,
  CreateFieldDateOverrideInput,
  UpdateFieldDateOverrideInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface FieldDateOverrideRow {
  id: string;
  season_field_id: string;
  date: string;
  override_type: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  single_event_only: number;
  created_at: string;
  updated_at: string;
}

function rowToFieldDateOverride(row: FieldDateOverrideRow): FieldDateOverride {
  return {
    id: row.id,
    seasonFieldId: row.season_field_id,
    date: row.date,
    overrideType: row.override_type as 'blackout' | 'added',
    startTime: row.start_time || undefined,
    endTime: row.end_time || undefined,
    reason: row.reason || undefined,
    singleEventOnly: Boolean(row.single_event_only),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List field date overrides, optionally filtered by season field
 */
export async function listFieldDateOverrides(
  db: D1Database,
  seasonFieldId?: string
): Promise<FieldDateOverride[]> {
  let result;
  if (seasonFieldId) {
    result = await db
      .prepare('SELECT * FROM field_date_overrides WHERE season_field_id = ? ORDER BY date')
      .bind(seasonFieldId)
      .all<FieldDateOverrideRow>();
  } else {
    result = await db
      .prepare('SELECT * FROM field_date_overrides ORDER BY date')
      .all<FieldDateOverrideRow>();
  }

  return (result.results || []).map(rowToFieldDateOverride);
}

/**
 * List all field date overrides for a season (joins through season_fields)
 */
export async function listFieldDateOverridesForSeason(
  db: D1Database,
  seasonId: string
): Promise<FieldDateOverride[]> {
  const result = await db
    .prepare(`
      SELECT fdo.*
      FROM field_date_overrides fdo
      JOIN season_fields sf ON fdo.season_field_id = sf.id
      WHERE sf.season_id = ?
      ORDER BY fdo.date
    `)
    .bind(seasonId)
    .all<FieldDateOverrideRow>();

  return (result.results || []).map(rowToFieldDateOverride);
}

export async function getFieldDateOverrideById(
  db: D1Database,
  id: string
): Promise<FieldDateOverride | null> {
  const result = await db
    .prepare('SELECT * FROM field_date_overrides WHERE id = ?')
    .bind(id)
    .first<FieldDateOverrideRow>();

  return result ? rowToFieldDateOverride(result) : null;
}

export async function createFieldDateOverride(
  db: D1Database,
  input: CreateFieldDateOverrideInput
): Promise<FieldDateOverride> {
  const id = generateId();
  const now = new Date().toISOString();
  const singleEventOnly = input.singleEventOnly ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO field_date_overrides (id, season_field_id, date, override_type, start_time, end_time, reason, single_event_only, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.seasonFieldId,
      input.date,
      input.overrideType,
      input.startTime || null,
      input.endTime || null,
      input.reason || null,
      singleEventOnly,
      now,
      now
    )
    .run();

  const override = await getFieldDateOverrideById(db, id);
  if (!override) {
    throw new Error('Failed to create field date override');
  }

  return override;
}

export async function updateFieldDateOverride(
  db: D1Database,
  id: string,
  input: UpdateFieldDateOverrideInput
): Promise<FieldDateOverride | null> {
  const existing = await getFieldDateOverrideById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.date !== undefined) {
    updates.push('date = ?');
    values.push(input.date);
  }
  if (input.overrideType !== undefined) {
    updates.push('override_type = ?');
    values.push(input.overrideType);
  }
  if (input.startTime !== undefined) {
    updates.push('start_time = ?');
    values.push(input.startTime);
  }
  if (input.endTime !== undefined) {
    updates.push('end_time = ?');
    values.push(input.endTime);
  }
  if (input.reason !== undefined) {
    updates.push('reason = ?');
    values.push(input.reason);
  }
  if (input.singleEventOnly !== undefined) {
    updates.push('single_event_only = ?');
    values.push(input.singleEventOnly ? 1 : 0);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE field_date_overrides SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getFieldDateOverrideById(db, id);
}

export async function deleteFieldDateOverride(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM field_date_overrides WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
