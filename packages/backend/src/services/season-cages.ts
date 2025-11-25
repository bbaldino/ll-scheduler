import type {
  SeasonCage,
  CreateSeasonCageInput,
  UpdateSeasonCageInput,
  BattingCage,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';

interface SeasonCageRow {
  id: string;
  season_id: string;
  cage_id: string;
  created_at: string;
  updated_at: string;
}

interface SeasonCageWithCageRow extends SeasonCageRow {
  cage_name: string;
  cage_division_compatibility: string;
  cage_created_at: string;
  cage_updated_at: string;
}

function rowToSeasonCage(row: SeasonCageRow): SeasonCage {
  return {
    id: row.id,
    seasonId: row.season_id,
    cageId: row.cage_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSeasonCageWithCage(row: SeasonCageWithCageRow): SeasonCage {
  const divisionCompatibility = JSON.parse(row.cage_division_compatibility || '[]');
  return {
    id: row.id,
    seasonId: row.season_id,
    cageId: row.cage_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cage: {
      id: row.cage_id,
      name: row.cage_name,
      divisionCompatibility,
      createdAt: row.cage_created_at,
      updatedAt: row.cage_updated_at,
    },
    cageName: row.cage_name,
    divisionCompatibility, // Convenience: copy from cage
  };
}

/**
 * List all season cages for a season (with cage details)
 */
export async function listSeasonCages(db: D1Database, seasonId: string): Promise<SeasonCage[]> {
  const result = await db
    .prepare(`
      SELECT
        sc.*,
        bc.name as cage_name,
        bc.division_compatibility as cage_division_compatibility,
        bc.created_at as cage_created_at,
        bc.updated_at as cage_updated_at
      FROM season_cages sc
      JOIN batting_cages bc ON sc.cage_id = bc.id
      WHERE sc.season_id = ?
      ORDER BY bc.name
    `)
    .bind(seasonId)
    .all<SeasonCageWithCageRow>();

  return (result.results || []).map(rowToSeasonCageWithCage);
}

/**
 * Get a season cage by ID
 */
export async function getSeasonCageById(db: D1Database, id: string): Promise<SeasonCage | null> {
  const result = await db
    .prepare(`
      SELECT
        sc.*,
        bc.name as cage_name,
        bc.division_compatibility as cage_division_compatibility,
        bc.created_at as cage_created_at,
        bc.updated_at as cage_updated_at
      FROM season_cages sc
      JOIN batting_cages bc ON sc.cage_id = bc.id
      WHERE sc.id = ?
    `)
    .bind(id)
    .first<SeasonCageWithCageRow>();

  return result ? rowToSeasonCageWithCage(result) : null;
}

/**
 * Get a season cage by season and cage IDs
 */
export async function getSeasonCageBySeasonAndCage(
  db: D1Database,
  seasonId: string,
  cageId: string
): Promise<SeasonCage | null> {
  const result = await db
    .prepare(`
      SELECT
        sc.*,
        bc.name as cage_name,
        bc.division_compatibility as cage_division_compatibility,
        bc.created_at as cage_created_at,
        bc.updated_at as cage_updated_at
      FROM season_cages sc
      JOIN batting_cages bc ON sc.cage_id = bc.id
      WHERE sc.season_id = ? AND sc.cage_id = ?
    `)
    .bind(seasonId, cageId)
    .first<SeasonCageWithCageRow>();

  return result ? rowToSeasonCageWithCage(result) : null;
}

/**
 * Add a cage to a season
 */
export async function createSeasonCage(
  db: D1Database,
  input: CreateSeasonCageInput
): Promise<SeasonCage> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO season_cages (id, season_id, cage_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, input.seasonId, input.cageId, now, now)
    .run();

  const seasonCage = await getSeasonCageById(db, id);
  if (!seasonCage) {
    throw new Error('Failed to create season cage');
  }

  return seasonCage;
}

/**
 * Update a season cage
 * Note: Division compatibility is now managed on the global BattingCage, not SeasonCage
 */
export async function updateSeasonCage(
  db: D1Database,
  id: string,
  _input: UpdateSeasonCageInput
): Promise<SeasonCage | null> {
  const existing = await getSeasonCageById(db, id);
  if (!existing) {
    return null;
  }

  // Currently no updatable fields on season_cages
  // Division compatibility is managed on the global BattingCage
  // Availability is managed separately via cage_availabilities

  return existing;
}

/**
 * Remove a cage from a season
 */
export async function deleteSeasonCage(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM season_cages WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
