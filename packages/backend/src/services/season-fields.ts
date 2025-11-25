import type {
  SeasonField,
  CreateSeasonFieldInput,
  UpdateSeasonFieldInput,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface SeasonFieldRow {
  id: string;
  season_id: string;
  field_id: string;
  created_at: string;
  updated_at: string;
}

interface SeasonFieldWithFieldRow extends SeasonFieldRow {
  field_name: string;
  field_division_compatibility: string;
  field_created_at: string;
  field_updated_at: string;
}

function rowToSeasonField(row: SeasonFieldRow): SeasonField {
  return {
    id: row.id,
    seasonId: row.season_id,
    fieldId: row.field_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSeasonFieldWithField(row: SeasonFieldWithFieldRow): SeasonField {
  const divisionCompatibility = JSON.parse(row.field_division_compatibility || '[]');
  return {
    id: row.id,
    seasonId: row.season_id,
    fieldId: row.field_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    field: {
      id: row.field_id,
      name: row.field_name,
      divisionCompatibility,
      createdAt: row.field_created_at,
      updatedAt: row.field_updated_at,
    },
    fieldName: row.field_name,
    divisionCompatibility, // Convenience: copy from field
  };
}

/**
 * List all season fields for a season (with field details)
 */
export async function listSeasonFields(db: D1Database, seasonId: string): Promise<SeasonField[]> {
  const result = await db
    .prepare(`
      SELECT
        sf.*,
        f.name as field_name,
        f.division_compatibility as field_division_compatibility,
        f.created_at as field_created_at,
        f.updated_at as field_updated_at
      FROM season_fields sf
      JOIN fields f ON sf.field_id = f.id
      WHERE sf.season_id = ?
      ORDER BY f.name
    `)
    .bind(seasonId)
    .all<SeasonFieldWithFieldRow>();

  return (result.results || []).map(rowToSeasonFieldWithField);
}

/**
 * Get a season field by ID
 */
export async function getSeasonFieldById(db: D1Database, id: string): Promise<SeasonField | null> {
  const result = await db
    .prepare(`
      SELECT
        sf.*,
        f.name as field_name,
        f.division_compatibility as field_division_compatibility,
        f.created_at as field_created_at,
        f.updated_at as field_updated_at
      FROM season_fields sf
      JOIN fields f ON sf.field_id = f.id
      WHERE sf.id = ?
    `)
    .bind(id)
    .first<SeasonFieldWithFieldRow>();

  return result ? rowToSeasonFieldWithField(result) : null;
}

/**
 * Get a season field by season and field IDs
 */
export async function getSeasonFieldBySeasonAndField(
  db: D1Database,
  seasonId: string,
  fieldId: string
): Promise<SeasonField | null> {
  const result = await db
    .prepare(`
      SELECT
        sf.*,
        f.name as field_name,
        f.division_compatibility as field_division_compatibility,
        f.created_at as field_created_at,
        f.updated_at as field_updated_at
      FROM season_fields sf
      JOIN fields f ON sf.field_id = f.id
      WHERE sf.season_id = ? AND sf.field_id = ?
    `)
    .bind(seasonId, fieldId)
    .first<SeasonFieldWithFieldRow>();

  return result ? rowToSeasonFieldWithField(result) : null;
}

/**
 * Add a field to a season
 */
export async function createSeasonField(
  db: D1Database,
  input: CreateSeasonFieldInput
): Promise<SeasonField> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO season_fields (id, season_id, field_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, input.seasonId, input.fieldId, now, now)
    .run();

  const seasonField = await getSeasonFieldById(db, id);
  if (!seasonField) {
    throw new Error('Failed to create season field');
  }

  return seasonField;
}

/**
 * Update a season field
 * Note: Division compatibility is now managed on the global Field, not SeasonField
 */
export async function updateSeasonField(
  db: D1Database,
  id: string,
  _input: UpdateSeasonFieldInput
): Promise<SeasonField | null> {
  const existing = await getSeasonFieldById(db, id);
  if (!existing) {
    return null;
  }

  // Currently no updatable fields on season_fields
  // Division compatibility is managed on the global Field
  // Availability is managed separately via field_availabilities

  return existing;
}

/**
 * Remove a field from a season
 */
export async function deleteSeasonField(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM season_fields WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
