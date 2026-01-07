import type { Division, CreateDivisionInput, UpdateDivisionInput } from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface DivisionRow {
  id: string;
  name: string;
  scheduling_order: number;
  created_at: string;
  updated_at: string;
}

function rowToDivision(row: DivisionRow): Division {
  return {
    id: row.id,
    name: row.name,
    schedulingOrder: row.scheduling_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDivisions(db: D1Database): Promise<Division[]> {
  const result = await db.prepare('SELECT * FROM divisions ORDER BY scheduling_order, name').all<DivisionRow>();

  return (result.results || []).map(rowToDivision);
}

export async function getDivisionById(db: D1Database, id: string): Promise<Division | null> {
  const result = await db
    .prepare('SELECT * FROM divisions WHERE id = ?')
    .bind(id)
    .first<DivisionRow>();

  return result ? rowToDivision(result) : null;
}

export async function createDivision(db: D1Database, input: CreateDivisionInput): Promise<Division> {
  const id = generateId();
  const now = new Date().toISOString();

  // Get the next scheduling order (max + 1)
  const maxOrderResult = await db
    .prepare('SELECT MAX(scheduling_order) as max_order FROM divisions')
    .first<{ max_order: number | null }>();
  const nextOrder = (maxOrderResult?.max_order ?? -1) + 1;

  await db
    .prepare(
      'INSERT INTO divisions (id, name, scheduling_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(id, input.name, nextOrder, now, now)
    .run();

  const division = await getDivisionById(db, id);
  if (!division) {
    throw new Error('Failed to create division');
  }

  return division;
}

export async function updateDivision(
  db: D1Database,
  id: string,
  input: UpdateDivisionInput
): Promise<Division | null> {
  const existing = await getDivisionById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }

  if (input.schedulingOrder !== undefined) {
    updates.push('scheduling_order = ?');
    values.push(input.schedulingOrder);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE divisions SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getDivisionById(db, id);
}

export async function deleteDivision(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM divisions WHERE id = ?').bind(id).run();

  return (result.meta.changes ?? 0) > 0;
}

/**
 * Reorder divisions by updating their scheduling_order based on the provided array order
 */
export async function reorderDivisions(db: D1Database, divisionIds: string[]): Promise<Division[]> {
  const now = new Date().toISOString();

  // Update each division's scheduling_order based on its position in the array
  for (let i = 0; i < divisionIds.length; i++) {
    await db
      .prepare('UPDATE divisions SET scheduling_order = ?, updated_at = ? WHERE id = ?')
      .bind(i, now, divisionIds[i])
      .run();
  }

  return await listDivisions(db);
}
