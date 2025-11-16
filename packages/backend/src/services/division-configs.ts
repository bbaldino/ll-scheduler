import type {
  DivisionConfig,
  CreateDivisionConfigInput,
  UpdateDivisionConfigInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface DivisionConfigRow {
  id: string;
  division_id: string;
  season_id: string;
  practices_per_week: number;
  practice_duration_hours: number;
  games_per_week: number | null;
  game_duration_hours: number | null;
  min_consecutive_day_gap: number | null;
  created_at: string;
  updated_at: string;
}

function rowToDivisionConfig(row: DivisionConfigRow): DivisionConfig {
  return {
    id: row.id,
    divisionId: row.division_id,
    seasonId: row.season_id,
    practicesPerWeek: row.practices_per_week,
    practiceDurationHours: row.practice_duration_hours,
    gamesPerWeek: row.games_per_week || undefined,
    gameDurationHours: row.game_duration_hours || undefined,
    minConsecutiveDayGap: row.min_consecutive_day_gap || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDivisionConfigsBySeasonId(
  db: D1Database,
  seasonId: string
): Promise<DivisionConfig[]> {
  const result = await db
    .prepare('SELECT * FROM division_configs WHERE season_id = ?')
    .bind(seasonId)
    .all<DivisionConfigRow>();

  return (result.results || []).map(rowToDivisionConfig);
}

export async function getDivisionConfigById(
  db: D1Database,
  id: string
): Promise<DivisionConfig | null> {
  const result = await db
    .prepare('SELECT * FROM division_configs WHERE id = ?')
    .bind(id)
    .first<DivisionConfigRow>();

  return result ? rowToDivisionConfig(result) : null;
}

export async function getDivisionConfigByDivisionAndSeason(
  db: D1Database,
  divisionId: string,
  seasonId: string
): Promise<DivisionConfig | null> {
  const result = await db
    .prepare('SELECT * FROM division_configs WHERE division_id = ? AND season_id = ?')
    .bind(divisionId, seasonId)
    .first<DivisionConfigRow>();

  return result ? rowToDivisionConfig(result) : null;
}

export async function createDivisionConfig(
  db: D1Database,
  input: CreateDivisionConfigInput
): Promise<DivisionConfig> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO division_configs (id, division_id, season_id, practices_per_week, practice_duration_hours, games_per_week, game_duration_hours, min_consecutive_day_gap, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.divisionId,
      input.seasonId,
      input.practicesPerWeek,
      input.practiceDurationHours,
      input.gamesPerWeek || null,
      input.gameDurationHours || null,
      input.minConsecutiveDayGap || null,
      now,
      now
    )
    .run();

  const config = await getDivisionConfigById(db, id);
  if (!config) {
    throw new Error('Failed to create division config');
  }

  return config;
}

export async function updateDivisionConfig(
  db: D1Database,
  id: string,
  input: UpdateDivisionConfigInput
): Promise<DivisionConfig | null> {
  const existing = await getDivisionConfigById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.practicesPerWeek !== undefined) {
    updates.push('practices_per_week = ?');
    values.push(input.practicesPerWeek);
  }
  if (input.practiceDurationHours !== undefined) {
    updates.push('practice_duration_hours = ?');
    values.push(input.practiceDurationHours);
  }
  if (input.gamesPerWeek !== undefined) {
    updates.push('games_per_week = ?');
    values.push(input.gamesPerWeek);
  }
  if (input.gameDurationHours !== undefined) {
    updates.push('game_duration_hours = ?');
    values.push(input.gameDurationHours);
  }
  if (input.minConsecutiveDayGap !== undefined) {
    updates.push('min_consecutive_day_gap = ?');
    values.push(input.minConsecutiveDayGap);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE division_configs SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getDivisionConfigById(db, id);
}

export async function deleteDivisionConfig(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM division_configs WHERE id = ?').bind(id).run();

  return (result.meta.changes ?? 0) > 0;
}
