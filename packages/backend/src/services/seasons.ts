import type { Season, CreateSeasonInput, UpdateSeasonInput } from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface SeasonRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  games_start_date: string | null;
  blackout_dates: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToSeason(row: SeasonRow): Season {
  let blackoutDates: string[] | undefined;
  if (row.blackout_dates) {
    try {
      blackoutDates = JSON.parse(row.blackout_dates);
    } catch {
      blackoutDates = undefined;
    }
  }

  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    gamesStartDate: row.games_start_date ?? undefined,
    blackoutDates,
    status: row.status as any,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSeasons(db: D1Database): Promise<Season[]> {
  const result = await db
    .prepare('SELECT * FROM seasons ORDER BY start_date DESC')
    .all<SeasonRow>();

  return (result.results || []).map(rowToSeason);
}

export async function getSeasonById(db: D1Database, id: string): Promise<Season | null> {
  const result = await db
    .prepare('SELECT * FROM seasons WHERE id = ?')
    .bind(id)
    .first<SeasonRow>();

  return result ? rowToSeason(result) : null;
}

export async function createSeason(db: D1Database, input: CreateSeasonInput): Promise<Season> {
  const id = generateId();
  const now = new Date().toISOString();

  // If copyFromSeasonId is provided, we'll handle copying in a future enhancement

  await db
    .prepare(
      `INSERT INTO seasons (id, name, start_date, end_date, games_start_date, blackout_dates, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    )
    .bind(
      id,
      input.name,
      input.startDate,
      input.endDate,
      input.gamesStartDate ?? null,
      input.blackoutDates ? JSON.stringify(input.blackoutDates) : null,
      now,
      now
    )
    .run();

  const season = await getSeasonById(db, id);
  if (!season) {
    throw new Error('Failed to create season');
  }

  return season;
}

export async function updateSeason(
  db: D1Database,
  id: string,
  input: UpdateSeasonInput
): Promise<Season | null> {
  const existing = await getSeasonById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.startDate !== undefined) {
    updates.push('start_date = ?');
    values.push(input.startDate);
  }
  if (input.endDate !== undefined) {
    updates.push('end_date = ?');
    values.push(input.endDate);
  }
  if (input.gamesStartDate !== undefined) {
    updates.push('games_start_date = ?');
    values.push(input.gamesStartDate);
  }
  if (input.blackoutDates !== undefined) {
    updates.push('blackout_dates = ?');
    values.push(input.blackoutDates ? JSON.stringify(input.blackoutDates) : null);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE seasons SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getSeasonById(db, id);
}

export async function deleteSeason(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM seasons WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
