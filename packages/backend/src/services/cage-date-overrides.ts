import type {
  CageDateOverride,
  CreateCageDateOverrideInput,
  UpdateCageDateOverrideInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface CageDateOverrideRow {
  id: string;
  season_cage_id: string;
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
    seasonCageId: row.season_cage_id,
    date: row.date,
    overrideType: row.override_type as 'blackout' | 'added',
    startTime: row.start_time || undefined,
    endTime: row.end_time || undefined,
    reason: row.reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List cage date overrides, optionally filtered by season cage
 */
export async function listCageDateOverrides(
  db: D1Database,
  seasonCageId?: string
): Promise<CageDateOverride[]> {
  let result;
  if (seasonCageId) {
    result = await db
      .prepare('SELECT * FROM cage_date_overrides WHERE season_cage_id = ? ORDER BY date')
      .bind(seasonCageId)
      .all<CageDateOverrideRow>();
  } else {
    result = await db
      .prepare('SELECT * FROM cage_date_overrides ORDER BY date')
      .all<CageDateOverrideRow>();
  }

  return (result.results || []).map(rowToCageDateOverride);
}

/**
 * List all cage date overrides for a season (joins through season_cages)
 */
export async function listCageDateOverridesForSeason(
  db: D1Database,
  seasonId: string
): Promise<CageDateOverride[]> {
  const result = await db
    .prepare(`
      SELECT cdo.*
      FROM cage_date_overrides cdo
      JOIN season_cages sc ON cdo.season_cage_id = sc.id
      WHERE sc.season_id = ?
      ORDER BY cdo.date
    `)
    .bind(seasonId)
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
      `INSERT INTO cage_date_overrides (id, season_cage_id, date, override_type, start_time, end_time, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.seasonCageId,
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
