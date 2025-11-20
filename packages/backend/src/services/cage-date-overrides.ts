import type {
  CageDateOverride,
  CreateCageDateOverrideInput,
  UpdateCageDateOverrideInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface CageDateOverrideRow {
  id: string;
  cage_id: string;
  date: string;
  override_type: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCageDateOverride(row: CageDateOverrideRow): CageDateOverride {
  return {
    id: row.id,
    cageId: row.cage_id,
    date: row.date,
    overrideType: row.override_type as any,
    startTime: row.start_time,
    endTime: row.end_time,
    reason: row.reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCageDateOverrides(
  db: D1Database,
  cageId: string
): Promise<CageDateOverride[]> {
  const result = await db
    .prepare('SELECT * FROM cage_date_overrides WHERE cage_id = ? ORDER BY date')
    .bind(cageId)
    .all<CageDateOverrideRow>();

  return (result.results || []).map(rowToCageDateOverride);
}

export async function getCageDateOverrideById(
  db: D1Database,
  id: string
): Promise<CageDateOverride | null> {
  const result = await db
    .prepare('SELECT * FROM cage_date_overrides WHERE id = ?')
    .bind(id)
    .first<CageDateOverrideRow>();

  return result ? rowToCageDateOverride(result) : null;
}

export async function createCageDateOverride(
  db: D1Database,
  input: CreateCageDateOverrideInput
): Promise<CageDateOverride> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO cage_date_overrides (id, cage_id, date, override_type, start_time, end_time, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.cageId,
      input.date,
      input.overrideType,
      input.startTime || null,
      input.endTime || null,
      input.reason || null,
      now,
      now
    )
    .run();

  const override = await getCageDateOverrideById(db, id);
  if (!override) {
    throw new Error('Failed to create cage date override');
  }

  return override;
}

export async function updateCageDateOverride(
  db: D1Database,
  id: string,
  input: UpdateCageDateOverrideInput
): Promise<CageDateOverride | null> {
  const existing = await getCageDateOverrideById(db, id);
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
    .prepare(`UPDATE cage_date_overrides SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getCageDateOverrideById(db, id);
}

export async function deleteCageDateOverride(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM cage_date_overrides WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
