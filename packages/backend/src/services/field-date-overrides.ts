import type {
  FieldDateOverride,
  CreateFieldDateOverrideInput,
  UpdateFieldDateOverrideInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface FieldDateOverrideRow {
  id: string;
  field_id: string;
  date: string;
  override_type: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

function rowToFieldDateOverride(row: FieldDateOverrideRow): FieldDateOverride {
  return {
    id: row.id,
    fieldId: row.field_id,
    date: row.date,
    overrideType: row.override_type as any,
    startTime: row.start_time,
    endTime: row.end_time,
    reason: row.reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listFieldDateOverrides(
  db: D1Database,
  fieldId: string
): Promise<FieldDateOverride[]> {
  const result = await db
    .prepare('SELECT * FROM field_date_overrides WHERE field_id = ? ORDER BY date')
    .bind(fieldId)
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

  await db
    .prepare(
      `INSERT INTO field_date_overrides (id, field_id, date, override_type, start_time, end_time, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.fieldId,
      input.date,
      input.overrideType,
      input.startTime || null,
      input.endTime || null,
      input.reason || null,
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
