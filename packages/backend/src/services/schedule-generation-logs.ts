import type {
  ScheduleGenerationLog,
  GenerateScheduleResult,
  SchedulingLogEntry,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface ScheduleGenerationLogRow {
  id: string;
  season_id: string;
  success: number;
  events_created: number;
  message: string | null;
  statistics: string | null;
  errors: string | null;
  warnings: string | null;
  created_at: string;
}

interface ScheduleGenerationLogEntryRow {
  id: string;
  log_id: string;
  entry_index: number;
  timestamp: string;
  level: string;
  category: string;
  message: string;
  summary: string | null;
  details: string | null;
}

function rowToScheduleGenerationLog(
  row: ScheduleGenerationLogRow,
  entries?: SchedulingLogEntry[]
): ScheduleGenerationLog {
  return {
    id: row.id,
    seasonId: row.season_id,
    success: row.success === 1,
    eventsCreated: row.events_created,
    message: row.message || undefined,
    statistics: row.statistics ? JSON.parse(row.statistics) : undefined,
    log: entries,
    errors: row.errors ? JSON.parse(row.errors) : undefined,
    warnings: row.warnings ? JSON.parse(row.warnings) : undefined,
    createdAt: row.created_at,
  };
}

function entryRowToLogEntry(row: ScheduleGenerationLogEntryRow): SchedulingLogEntry {
  return {
    timestamp: row.timestamp,
    level: row.level as SchedulingLogEntry['level'],
    category: row.category as SchedulingLogEntry['category'],
    message: row.message,
    summary: row.summary || undefined,
    details: row.details ? JSON.parse(row.details) : undefined,
  };
}

export async function saveScheduleGenerationLog(
  db: D1Database,
  seasonId: string,
  result: GenerateScheduleResult
): Promise<ScheduleGenerationLog> {
  const id = generateId();
  const now = new Date().toISOString();

  // Insert the main log record (without the log entries)
  await db
    .prepare(
      `INSERT INTO schedule_generation_logs (
        id, season_id, success, events_created, message,
        statistics, errors, warnings, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      seasonId,
      result.success ? 1 : 0,
      result.eventsCreated,
      result.message || null,
      result.statistics ? JSON.stringify(result.statistics) : null,
      result.errors ? JSON.stringify(result.errors) : null,
      result.warnings ? JSON.stringify(result.warnings) : null,
      now
    )
    .run();

  // Insert log entries in batches to avoid hitting limits
  if (result.schedulingLog && result.schedulingLog.length > 0) {
    const BATCH_SIZE = 100;
    const entries = result.schedulingLog;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const statements = batch.map((entry, batchIndex) => {
        const entryId = generateId();
        const entryIndex = i + batchIndex;
        return db
          .prepare(
            `INSERT INTO schedule_generation_log_entries (
              id, log_id, entry_index, timestamp, level, category, message, summary, details
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            entryId,
            id,
            entryIndex,
            entry.timestamp,
            entry.level,
            entry.category,
            entry.message,
            entry.summary || null,
            entry.details ? JSON.stringify(entry.details) : null
          );
      });

      await db.batch(statements);
    }
  }

  const log = await getScheduleGenerationLogById(db, id);
  if (!log) {
    throw new Error('Failed to save schedule generation log');
  }

  return log;
}

export async function getScheduleGenerationLogById(
  db: D1Database,
  id: string
): Promise<ScheduleGenerationLog | null> {
  const result = await db
    .prepare('SELECT * FROM schedule_generation_logs WHERE id = ?')
    .bind(id)
    .first<ScheduleGenerationLogRow>();

  if (!result) {
    return null;
  }

  // Fetch log entries
  const entriesResult = await db
    .prepare(
      'SELECT * FROM schedule_generation_log_entries WHERE log_id = ? ORDER BY entry_index'
    )
    .bind(id)
    .all<ScheduleGenerationLogEntryRow>();

  const entries = (entriesResult.results || []).map(entryRowToLogEntry);

  return rowToScheduleGenerationLog(result, entries.length > 0 ? entries : undefined);
}

export async function getLatestScheduleGenerationLog(
  db: D1Database,
  seasonId: string
): Promise<ScheduleGenerationLog | null> {
  const result = await db
    .prepare(
      'SELECT * FROM schedule_generation_logs WHERE season_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .bind(seasonId)
    .first<ScheduleGenerationLogRow>();

  if (!result) {
    return null;
  }

  // Fetch log entries
  const entriesResult = await db
    .prepare(
      'SELECT * FROM schedule_generation_log_entries WHERE log_id = ? ORDER BY entry_index'
    )
    .bind(result.id)
    .all<ScheduleGenerationLogEntryRow>();

  const entries = (entriesResult.results || []).map(entryRowToLogEntry);

  return rowToScheduleGenerationLog(result, entries.length > 0 ? entries : undefined);
}

export async function listScheduleGenerationLogs(
  db: D1Database,
  seasonId: string,
  limit: number = 10
): Promise<ScheduleGenerationLog[]> {
  const result = await db
    .prepare(
      'SELECT * FROM schedule_generation_logs WHERE season_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .bind(seasonId, limit)
    .all<ScheduleGenerationLogRow>();

  // For list view, we don't load the full log entries (they can be large)
  // Callers should use getScheduleGenerationLogById for full details
  return (result.results || []).map((row) => rowToScheduleGenerationLog(row, undefined));
}

export async function deleteScheduleGenerationLog(
  db: D1Database,
  id: string
): Promise<boolean> {
  // Entries are deleted automatically via CASCADE
  const result = await db
    .prepare('DELETE FROM schedule_generation_logs WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
