import type { Field, CreateFieldInput, UpdateFieldInput } from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface FieldRow {
  id: string;
  name: string;
  division_compatibility: string;
  created_at: string;
  updated_at: string;
}

function rowToField(row: FieldRow): Field {
  return {
    id: row.id,
    name: row.name,
    divisionCompatibility: JSON.parse(row.division_compatibility || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List all global fields
 */
export async function listFields(db: D1Database): Promise<Field[]> {
  const result = await db
    .prepare('SELECT * FROM fields ORDER BY name')
    .all<FieldRow>();

  return (result.results || []).map(rowToField);
}

/**
 * Get a field by ID
 */
export async function getFieldById(db: D1Database, id: string): Promise<Field | null> {
  const result = await db
    .prepare('SELECT * FROM fields WHERE id = ?')
    .bind(id)
    .first<FieldRow>();

  return result ? rowToField(result) : null;
}

/**
 * Create a new global field
 */
export async function createField(db: D1Database, input: CreateFieldInput): Promise<Field> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      'INSERT INTO fields (id, name, division_compatibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(id, input.name, JSON.stringify(input.divisionCompatibility || []), now, now)
    .run();

  const field = await getFieldById(db, id);
  if (!field) {
    throw new Error('Failed to create field');
  }

  return field;
}

/**
 * Update a field
 */
export async function updateField(
  db: D1Database,
  id: string,
  input: UpdateFieldInput
): Promise<Field | null> {
  const existing = await getFieldById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }

  if (input.divisionCompatibility !== undefined) {
    updates.push('division_compatibility = ?');
    values.push(JSON.stringify(input.divisionCompatibility));
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db
      .prepare(`UPDATE fields SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return await getFieldById(db, id);
}

/**
 * Delete a field
 */
export async function deleteField(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM fields WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
