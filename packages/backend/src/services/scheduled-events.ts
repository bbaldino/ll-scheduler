import type {
  ScheduledEvent,
  CreateScheduledEventInput,
  UpdateScheduledEventInput,
  ScheduledEventQuery,
  EventType,
  EventStatus,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface ScheduledEventRow {
  id: string;
  season_period_id: string;
  division_id: string;
  event_type: EventType;
  date: string;
  start_time: string;
  end_time: string;
  status: EventStatus;
  notes: string | null;
  field_id: string | null;
  cage_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  team_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToScheduledEvent(row: ScheduledEventRow): ScheduledEvent {
  return {
    id: row.id,
    seasonPeriodId: row.season_period_id,
    divisionId: row.division_id,
    eventType: row.event_type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    notes: row.notes || undefined,
    fieldId: row.field_id || undefined,
    cageId: row.cage_id || undefined,
    homeTeamId: row.home_team_id || undefined,
    awayTeamId: row.away_team_id || undefined,
    teamId: row.team_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listScheduledEvents(
  db: D1Database,
  query: ScheduledEventQuery = {}
): Promise<ScheduledEvent[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (query.seasonPeriodId) {
    conditions.push('season_period_id = ?');
    params.push(query.seasonPeriodId);
  }
  if (query.seasonPeriodIds && query.seasonPeriodIds.length > 0) {
    const placeholders = query.seasonPeriodIds.map(() => '?').join(',');
    conditions.push(`season_period_id IN (${placeholders})`);
    params.push(...query.seasonPeriodIds);
  }
  if (query.divisionId) {
    conditions.push('division_id = ?');
    params.push(query.divisionId);
  }
  if (query.eventType) {
    conditions.push('event_type = ?');
    params.push(query.eventType);
  }
  if (query.status) {
    conditions.push('status = ?');
    params.push(query.status);
  }
  if (query.fieldId) {
    conditions.push('field_id = ?');
    params.push(query.fieldId);
  }
  if (query.cageId) {
    conditions.push('cage_id = ?');
    params.push(query.cageId);
  }
  if (query.teamId) {
    conditions.push('(team_id = ? OR home_team_id = ? OR away_team_id = ?)');
    params.push(query.teamId, query.teamId, query.teamId);
  }
  if (query.startDate) {
    conditions.push('date >= ?');
    params.push(query.startDate);
  }
  if (query.endDate) {
    conditions.push('date <= ?');
    params.push(query.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM scheduled_events ${whereClause} ORDER BY date, start_time`;

  const result = await db.prepare(sql).bind(...params).all<ScheduledEventRow>();

  return (result.results || []).map(rowToScheduledEvent);
}

export async function getScheduledEventById(
  db: D1Database,
  id: string
): Promise<ScheduledEvent | null> {
  const result = await db
    .prepare('SELECT * FROM scheduled_events WHERE id = ?')
    .bind(id)
    .first<ScheduledEventRow>();

  if (!result) {
    return null;
  }

  return rowToScheduledEvent(result);
}

export async function createScheduledEvent(
  db: D1Database,
  input: CreateScheduledEventInput
): Promise<ScheduledEvent> {
  const id = generateId();
  const now = new Date().toISOString();
  const status = input.status || 'scheduled';

  const bindValues = [
    id,
    input.seasonPeriodId,
    input.divisionId,
    input.eventType,
    input.date,
    input.startTime,
    input.endTime,
    status,
    input.notes || null,
    input.fieldId || null,
    input.cageId || null,
    input.homeTeamId || null,
    input.awayTeamId || null,
    input.teamId || null,
    now,
    now
  ];

  await db
    .prepare(
      `INSERT INTO scheduled_events (
        id, season_period_id, division_id, event_type, date, start_time, end_time,
        status, notes, field_id, cage_id, home_team_id, away_team_id, team_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(...bindValues)
    .run();

  const event = await getScheduledEventById(db, id);
  if (!event) {
    throw new Error('Failed to create scheduled event');
  }

  return event;
}

export async function updateScheduledEvent(
  db: D1Database,
  id: string,
  input: UpdateScheduledEventInput
): Promise<ScheduledEvent | null> {
  const existing = await getScheduledEventById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.date !== undefined) {
    updates.push('date = ?');
    values.push(input.date);
  }
  if (input.startTime !== undefined) {
    updates.push('start_time = ?');
    values.push(input.startTime);
  }
  if (input.endTime !== undefined) {
    updates.push('end_time = ?');
    values.push(input.endTime);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.notes !== undefined) {
    updates.push('notes = ?');
    values.push(input.notes || null);
  }
  if (input.fieldId !== undefined) {
    updates.push('field_id = ?');
    values.push(input.fieldId || null);
  }
  if (input.cageId !== undefined) {
    updates.push('cage_id = ?');
    values.push(input.cageId || null);
  }
  if (input.homeTeamId !== undefined) {
    updates.push('home_team_id = ?');
    values.push(input.homeTeamId || null);
  }
  if (input.awayTeamId !== undefined) {
    updates.push('away_team_id = ?');
    values.push(input.awayTeamId || null);
  }
  if (input.teamId !== undefined) {
    updates.push('team_id = ?');
    values.push(input.teamId || null);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db
      .prepare(`UPDATE scheduled_events SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return await getScheduledEventById(db, id);
}

export async function deleteScheduledEvent(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM scheduled_events WHERE id = ?').bind(id).run();

  return (result.meta.changes ?? 0) > 0;
}
