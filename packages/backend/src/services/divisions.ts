import type { Division, CreateDivisionInput, UpdateDivisionInput } from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface DivisionRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

function rowToDivision(row: DivisionRow): Division {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDivisions(db: D1Database): Promise<Division[]> {
  const result = await db.prepare('SELECT * FROM divisions ORDER BY name').all<DivisionRow>();

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

  await db
    .prepare(
      'INSERT INTO divisions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    )
    .bind(id, input.name, now, now)
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
