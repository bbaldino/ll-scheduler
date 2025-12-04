import type {
  ScheduleGenerationLog,
  GenerateScheduleResult,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface ScheduleGenerationLogRow {
  id: string;
  season_id: string;
  success: number;
  events_created: number;
  message: string | null;
  statistics: string | null;
  log: string | null;
  errors: string | null;
  warnings: string | null;
  created_at: string;
}

function rowToScheduleGenerationLog(row: ScheduleGenerationLogRow): ScheduleGenerationLog {
  return {
    id: row.id,
    seasonId: row.season_id,
    success: row.success === 1,
    eventsCreated: row.events_created,
    message: row.message || undefined,
    statistics: row.statistics ? JSON.parse(row.statistics) : undefined,
    log: row.log ? JSON.parse(row.log) : undefined,
    errors: row.errors ? JSON.parse(row.errors) : undefined,
    warnings: row.warnings ? JSON.parse(row.warnings) : undefined,
    createdAt: row.created_at,
  };
}

export async function saveScheduleGenerationLog(
  db: D1Database,
  seasonId: string,
  result: GenerateScheduleResult
): Promise<ScheduleGenerationLog> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO schedule_generation_logs (
        id, season_id, success, events_created, message,
        statistics, log, errors, warnings, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      seasonId,
      result.success ? 1 : 0,
      result.eventsCreated,
      result.message || null,
      result.statistics ? JSON.stringify(result.statistics) : null,
      result.schedulingLog ? JSON.stringify(result.schedulingLog) : null,
      result.errors ? JSON.stringify(result.errors) : null,
      result.warnings ? JSON.stringify(result.warnings) : null,
      now
    )
    .run();

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

  return result ? rowToScheduleGenerationLog(result) : null;
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

  return result ? rowToScheduleGenerationLog(result) : null;
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

  return (result.results || []).map(rowToScheduleGenerationLog);
}

export async function deleteScheduleGenerationLog(
  db: D1Database,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM schedule_generation_logs WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
