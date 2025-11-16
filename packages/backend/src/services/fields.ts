import type { Field, CreateFieldInput, UpdateFieldInput } from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface FieldRow {
  id: string;
  season_id: string;
  name: string;
  location: string | null;
  created_at: string;
  updated_at: string;
}

interface AvailabilityRow {
  id: string;
  field_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface BlackoutRow {
  id: string;
  field_id: string;
  date: string;
  reason: string | null;
  all_day: number;
  start_time: string | null;
  end_time: string | null;
}

async function getFieldAvailability(db: D1Database, fieldId: string) {
  const result = await db
    .prepare('SELECT * FROM field_availability_schedules WHERE field_id = ?')
    .bind(fieldId)
    .all<AvailabilityRow>();

  return (result.results || []).map((row) => ({
    id: row.id,
    dayOfWeek: row.day_of_week as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

async function getFieldBlackoutDates(db: D1Database, fieldId: string) {
  const result = await db
    .prepare('SELECT * FROM field_blackout_dates WHERE field_id = ?')
    .bind(fieldId)
    .all<BlackoutRow>();

  return (result.results || []).map((row) => ({
    id: row.id,
    date: row.date,
    reason: row.reason || undefined,
    allDay: row.all_day === 1,
    startTime: row.start_time || undefined,
    endTime: row.end_time || undefined,
  }));
}

async function getFieldDivisionCompatibility(db: D1Database, fieldId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT division_id FROM field_division_compatibility WHERE field_id = ?')
    .bind(fieldId)
    .all<{ division_id: string }>();

  return (result.results || []).map((row) => row.division_id);
}

async function buildFieldObject(db: D1Database, row: FieldRow): Promise<Field> {
  const [availability, blackouts, divisions] = await Promise.all([
    getFieldAvailability(db, row.id),
    getFieldBlackoutDates(db, row.id),
    getFieldDivisionCompatibility(db, row.id),
  ]);

  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    location: row.location || undefined,
    availabilitySchedules: availability,
    blackoutDates: blackouts,
    divisionCompatibility: divisions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listFields(db: D1Database, seasonId: string): Promise<Field[]> {
  const result = await db
    .prepare('SELECT * FROM fields WHERE season_id = ? ORDER BY name')
    .bind(seasonId)
    .all<FieldRow>();

  const rows = result.results || [];
  return Promise.all(rows.map((row) => buildFieldObject(db, row)));
}

export async function getFieldById(db: D1Database, id: string): Promise<Field | null> {
  const result = await db
    .prepare('SELECT * FROM fields WHERE id = ?')
    .bind(id)
    .first<FieldRow>();

  if (!result) {
    return null;
  }

  return buildFieldObject(db, result);
}

export async function createField(db: D1Database, input: CreateFieldInput): Promise<Field> {
  const id = generateId();
  const now = new Date().toISOString();

  // Insert field
  await db
    .prepare(
      'INSERT INTO fields (id, season_id, name, location, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id, input.seasonId, input.name, input.location || null, now, now)
    .run();

  // Insert availability schedules if provided
  if (input.availabilitySchedules && input.availabilitySchedules.length > 0) {
    for (const schedule of input.availabilitySchedules) {
      await db
        .prepare(
          'INSERT INTO field_availability_schedules (id, field_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(schedule.id, id, schedule.dayOfWeek, schedule.startTime, schedule.endTime)
        .run();
    }
  }

  // Insert blackout dates if provided
  if (input.blackoutDates && input.blackoutDates.length > 0) {
    for (const blackout of input.blackoutDates) {
      await db
        .prepare(
          'INSERT INTO field_blackout_dates (id, field_id, date, reason, all_day, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          blackout.id,
          id,
          blackout.date,
          blackout.reason || null,
          blackout.allDay ? 1 : 0,
          blackout.startTime || null,
          blackout.endTime || null
        )
        .run();
    }
  }

  // Insert division compatibility if provided
  if (input.divisionCompatibility && input.divisionCompatibility.length > 0) {
    for (const divisionId of input.divisionCompatibility) {
      await db
        .prepare(
          'INSERT INTO field_division_compatibility (field_id, division_id) VALUES (?, ?)'
        )
        .bind(id, divisionId)
        .run();
    }
  }

  const field = await getFieldById(db, id);
  if (!field) {
    throw new Error('Failed to create field');
  }

  return field;
}

export async function updateField(
  db: D1Database,
  id: string,
  input: UpdateFieldInput
): Promise<Field | null> {
  const existing = await getFieldById(db, id);
  if (!existing) {
    return null;
  }

  // Update basic field properties
  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.location !== undefined) {
    updates.push('location = ?');
    values.push(input.location);
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

  // Update availability schedules if provided
  if (input.availabilitySchedules !== undefined) {
    await db.prepare('DELETE FROM field_availability_schedules WHERE field_id = ?').bind(id).run();

    for (const schedule of input.availabilitySchedules) {
      await db
        .prepare(
          'INSERT INTO field_availability_schedules (id, field_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(schedule.id, id, schedule.dayOfWeek, schedule.startTime, schedule.endTime)
        .run();
    }
  }

  // Update blackout dates if provided
  if (input.blackoutDates !== undefined) {
    await db.prepare('DELETE FROM field_blackout_dates WHERE field_id = ?').bind(id).run();

    for (const blackout of input.blackoutDates) {
      await db
        .prepare(
          'INSERT INTO field_blackout_dates (id, field_id, date, reason, all_day, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          blackout.id,
          id,
          blackout.date,
          blackout.reason || null,
          blackout.allDay ? 1 : 0,
          blackout.startTime || null,
          blackout.endTime || null
        )
        .run();
    }
  }

  // Update division compatibility if provided
  if (input.divisionCompatibility !== undefined) {
    await db.prepare('DELETE FROM field_division_compatibility WHERE field_id = ?').bind(id).run();

    for (const divisionId of input.divisionCompatibility) {
      await db
        .prepare('INSERT INTO field_division_compatibility (field_id, division_id) VALUES (?, ?)')
        .bind(id, divisionId)
        .run();
    }
  }

  return await getFieldById(db, id);
}

export async function deleteField(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM fields WHERE id = ?').bind(id).run();

  return (result.meta.changes ?? 0) > 0;
}
