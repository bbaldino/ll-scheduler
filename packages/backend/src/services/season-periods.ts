import type { SeasonPeriod, CreateSeasonPeriodInput, UpdateSeasonPeriodInput, EventType } from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface SeasonPeriodRow {
  id: string;
  season_id: string;
  name: string;
  start_date: string;
  end_date: string;
  event_types: string; // Comma-separated: 'game', 'practice', 'cage'
  auto_schedule: number; // SQLite boolean (0 or 1)
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function parseEventTypes(eventTypesStr: string): EventType[] {
  return eventTypesStr.split(',').map(s => s.trim()) as EventType[];
}

function serializeEventTypes(eventTypes: EventType[]): string {
  return eventTypes.join(',');
}

function rowToSeasonPeriod(row: SeasonPeriodRow): SeasonPeriod {
  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    eventTypes: parseEventTypes(row.event_types),
    autoSchedule: row.auto_schedule === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSeasonPeriods(db: D1Database, seasonId: string): Promise<SeasonPeriod[]> {
  const result = await db
    .prepare('SELECT * FROM season_periods WHERE season_id = ? ORDER BY sort_order, start_date')
    .bind(seasonId)
    .all<SeasonPeriodRow>();

  return (result.results || []).map(rowToSeasonPeriod);
}

export async function getSeasonPeriodById(db: D1Database, id: string): Promise<SeasonPeriod | null> {
  const result = await db
    .prepare('SELECT * FROM season_periods WHERE id = ?')
    .bind(id)
    .first<SeasonPeriodRow>();

  return result ? rowToSeasonPeriod(result) : null;
}

export async function getSeasonPeriodsByIds(db: D1Database, ids: string[]): Promise<SeasonPeriod[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(',');
  const result = await db
    .prepare(`SELECT * FROM season_periods WHERE id IN (${placeholders}) ORDER BY sort_order, start_date`)
    .bind(...ids)
    .all<SeasonPeriodRow>();

  return (result.results || []).map(rowToSeasonPeriod);
}

export async function createSeasonPeriod(
  db: D1Database,
  input: CreateSeasonPeriodInput
): Promise<SeasonPeriod> {
  const id = generateId();
  const now = new Date().toISOString();
  const sortOrder = input.sortOrder ?? 0;
  const autoSchedule = input.autoSchedule ?? true;

  await db
    .prepare(
      `INSERT INTO season_periods (id, season_id, name, start_date, end_date, event_types, auto_schedule, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.seasonId,
      input.name,
      input.startDate,
      input.endDate,
      serializeEventTypes(input.eventTypes),
      autoSchedule ? 1 : 0,
      sortOrder,
      now,
      now
    )
    .run();

  const period = await getSeasonPeriodById(db, id);
  if (!period) {
    throw new Error('Failed to create season period');
  }

  return period;
}

export async function updateSeasonPeriod(
  db: D1Database,
  id: string,
  input: UpdateSeasonPeriodInput
): Promise<SeasonPeriod | null> {
  const existing = await getSeasonPeriodById(db, id);
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
  if (input.eventTypes !== undefined) {
    updates.push('event_types = ?');
    values.push(serializeEventTypes(input.eventTypes));
  }
  if (input.autoSchedule !== undefined) {
    updates.push('auto_schedule = ?');
    values.push(input.autoSchedule ? 1 : 0);
  }
  if (input.sortOrder !== undefined) {
    updates.push('sort_order = ?');
    values.push(input.sortOrder);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE season_periods SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return await getSeasonPeriodById(db, id);
}

export async function deleteSeasonPeriod(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM season_periods WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
