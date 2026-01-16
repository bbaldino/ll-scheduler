import type {
  SavedSchedule,
  CreateSavedScheduleInput,
  RestoreScheduleResult,
  ScheduledEvent,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';
import { listScheduledEvents } from './scheduled-events.js';

const BATCH_SIZE = 50;

interface SavedScheduleRow {
  id: string;
  season_id: string;
  name: string;
  description: string | null;
  event_count: number;
  created_at: string;
  updated_at: string;
}

interface SavedScheduleEventRow {
  id: string;
  saved_schedule_id: string;
  original_event_id: string;
  division_id: string;
  event_type: string;
  date: string;
  start_time: string;
  end_time: string;
  field_id: string | null;
  cage_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  team_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

function rowToSavedSchedule(row: SavedScheduleRow): SavedSchedule {
  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    description: row.description || undefined,
    eventCount: row.event_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List all saved schedules for a season
 */
export async function listSavedSchedules(
  db: D1Database,
  seasonId: string
): Promise<SavedSchedule[]> {
  const result = await db
    .prepare('SELECT * FROM saved_schedules WHERE season_id = ? ORDER BY created_at DESC')
    .bind(seasonId)
    .all<SavedScheduleRow>();

  return (result.results || []).map(rowToSavedSchedule);
}

/**
 * Get a saved schedule by ID
 */
export async function getSavedScheduleById(
  db: D1Database,
  id: string
): Promise<SavedSchedule | null> {
  const result = await db
    .prepare('SELECT * FROM saved_schedules WHERE id = ?')
    .bind(id)
    .first<SavedScheduleRow>();

  return result ? rowToSavedSchedule(result) : null;
}

/**
 * Save the current schedule for a season
 * Copies all scheduled_events to saved_schedule_events
 */
export async function saveSchedule(
  db: D1Database,
  input: CreateSavedScheduleInput
): Promise<SavedSchedule> {
  const { seasonId, name, description } = input;
  const savedScheduleId = generateId();
  const now = new Date().toISOString();

  // Get all current events for this season
  const events = await listScheduledEvents(db, { seasonId });

  // Create the saved schedule record
  await db
    .prepare(
      `INSERT INTO saved_schedules (id, season_id, name, description, event_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(savedScheduleId, seasonId, name, description || null, events.length, now, now)
    .run();

  // Copy events to saved_schedule_events in batches
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const statements = batch.map((event) =>
      db
        .prepare(
          `INSERT INTO saved_schedule_events
           (id, saved_schedule_id, original_event_id, division_id, event_type, date, start_time, end_time,
            field_id, cage_id, home_team_id, away_team_id, team_id, status, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          generateId(),
          savedScheduleId,
          event.id,
          event.divisionId,
          event.eventType,
          event.date,
          event.startTime,
          event.endTime,
          event.fieldId || null,
          event.cageId || null,
          event.homeTeamId || null,
          event.awayTeamId || null,
          event.teamId || null,
          event.status,
          event.notes || null,
          now
        )
    );
    await db.batch(statements);
  }

  const savedSchedule = await getSavedScheduleById(db, savedScheduleId);
  if (!savedSchedule) {
    throw new Error('Failed to create saved schedule');
  }

  return savedSchedule;
}

/**
 * Restore a saved schedule
 * Deletes all current events for the season and copies saved events back
 */
export async function restoreSchedule(
  db: D1Database,
  savedScheduleId: string
): Promise<RestoreScheduleResult> {
  // Get the saved schedule to verify it exists and get the season ID
  const savedSchedule = await getSavedScheduleById(db, savedScheduleId);
  if (!savedSchedule) {
    throw new Error('Saved schedule not found');
  }

  // Get current event count before deletion
  const currentEvents = await listScheduledEvents(db, { seasonId: savedSchedule.seasonId });
  const deletedCount = currentEvents.length;

  // Delete all current events for this season
  await db
    .prepare('DELETE FROM scheduled_events WHERE season_id = ?')
    .bind(savedSchedule.seasonId)
    .run();

  // Get saved events
  const savedEventsResult = await db
    .prepare('SELECT * FROM saved_schedule_events WHERE saved_schedule_id = ?')
    .bind(savedScheduleId)
    .all<SavedScheduleEventRow>();

  const savedEvents = savedEventsResult.results || [];
  const now = new Date().toISOString();

  // Copy saved events back to scheduled_events in batches
  for (let i = 0; i < savedEvents.length; i += BATCH_SIZE) {
    const batch = savedEvents.slice(i, i + BATCH_SIZE);
    const statements = batch.map((event) =>
      db
        .prepare(
          `INSERT INTO scheduled_events
           (id, season_id, division_id, event_type, date, start_time, end_time,
            field_id, cage_id, home_team_id, away_team_id, team_id, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          generateId(), // New ID for the restored event
          savedSchedule.seasonId,
          event.division_id,
          event.event_type,
          event.date,
          event.start_time,
          event.end_time,
          event.field_id,
          event.cage_id,
          event.home_team_id,
          event.away_team_id,
          event.team_id,
          event.status,
          event.notes,
          now,
          now
        )
    );
    await db.batch(statements);
  }

  return {
    restoredCount: savedEvents.length,
    deletedCount,
  };
}

/**
 * Delete a saved schedule (cascade deletes its events)
 */
export async function deleteSavedSchedule(
  db: D1Database,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM saved_schedules WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
