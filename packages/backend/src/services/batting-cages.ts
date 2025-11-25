import type {
  BattingCage,
  CreateBattingCageInput,
  UpdateBattingCageInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface BattingCageRow {
  id: string;
  name: string;
  division_compatibility: string;
  created_at: string;
  updated_at: string;
}

function rowToBattingCage(row: BattingCageRow): BattingCage {
  return {
    id: row.id,
    name: row.name,
    divisionCompatibility: JSON.parse(row.division_compatibility || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List all global batting cages
 */
export async function listBattingCages(db: D1Database): Promise<BattingCage[]> {
  const result = await db
    .prepare('SELECT * FROM batting_cages ORDER BY name')
    .all<BattingCageRow>();

  return (result.results || []).map(rowToBattingCage);
}

/**
 * Get a batting cage by ID
 */
export async function getBattingCageById(db: D1Database, id: string): Promise<BattingCage | null> {
  const result = await db
    .prepare('SELECT * FROM batting_cages WHERE id = ?')
    .bind(id)
    .first<BattingCageRow>();

  return result ? rowToBattingCage(result) : null;
}

/**
 * Create a new global batting cage
 */
export async function createBattingCage(
  db: D1Database,
  input: CreateBattingCageInput
): Promise<BattingCage> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO batting_cages (id, name, division_compatibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, input.name, JSON.stringify(input.divisionCompatibility || []), now, now)
    .run();

  const cage = await getBattingCageById(db, id);
  if (!cage) {
    throw new Error('Failed to create batting cage');
  }

  return cage;
}

/**
 * Update a batting cage
 */
export async function updateBattingCage(
  db: D1Database,
  id: string,
  input: UpdateBattingCageInput
): Promise<BattingCage | null> {
  const existing = await getBattingCageById(db, id);
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

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE batting_cages SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getBattingCageById(db, id);
}

/**
 * Delete a batting cage
 */
export async function deleteBattingCage(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM batting_cages WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
