import type {
  SavedConfig,
  CreateSavedConfigInput,
  RestoreConfigResult,
  DivisionConfig,
  SeasonBlackout,
} from '@ll-scheduler/shared';
import { generateId } from '../utils/id.js';
import { getSeasonById, updateSeason } from './seasons.js';
import { listDivisionConfigsBySeasonId } from './division-configs.js';
import { listFieldAvailabilitiesForSeason } from './field-availabilities.js';
import { listCageAvailabilitiesForSeason } from './cage-availabilities.js';
import { listFieldDateOverridesForSeason } from './field-date-overrides.js';
import { listCageDateOverridesForSeason } from './cage-date-overrides.js';

const BATCH_SIZE = 50;

interface SavedConfigRow {
  id: string;
  season_id: string;
  name: string;
  description: string | null;
  season_blackout_dates: string | null;
  created_at: string;
  updated_at: string;
}

interface SavedConfigDivisionConfigRow {
  id: string;
  saved_config_id: string;
  division_id: string;
  config_json: string;
  created_at: string;
}

interface SavedConfigFieldAvailabilityRow {
  id: string;
  saved_config_id: string;
  season_field_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at: string;
}

interface SavedConfigCageAvailabilityRow {
  id: string;
  saved_config_id: string;
  season_cage_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at: string;
}

interface SavedConfigFieldDateOverrideRow {
  id: string;
  saved_config_id: string;
  season_field_id: string;
  date: string;
  override_type: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
}

interface SavedConfigCageDateOverrideRow {
  id: string;
  saved_config_id: string;
  season_cage_id: string;
  date: string;
  override_type: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
}

function rowToSavedConfig(row: SavedConfigRow): SavedConfig {
  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    description: row.description || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List all saved configs for a season
 */
export async function listSavedConfigs(
  db: D1Database,
  seasonId: string
): Promise<SavedConfig[]> {
  const result = await db
    .prepare('SELECT * FROM saved_configs WHERE season_id = ? ORDER BY created_at DESC')
    .bind(seasonId)
    .all<SavedConfigRow>();

  return (result.results || []).map(rowToSavedConfig);
}

/**
 * Get a saved config by ID
 */
export async function getSavedConfigById(
  db: D1Database,
  id: string
): Promise<SavedConfig | null> {
  const result = await db
    .prepare('SELECT * FROM saved_configs WHERE id = ?')
    .bind(id)
    .first<SavedConfigRow>();

  return result ? rowToSavedConfig(result) : null;
}

/**
 * Save the current configuration for a season
 */
export async function saveConfig(
  db: D1Database,
  input: CreateSavedConfigInput
): Promise<SavedConfig> {
  const { seasonId, name, description } = input;
  const savedConfigId = generateId();
  const now = new Date().toISOString();

  // Get season blackout dates
  const season = await getSeasonById(db, seasonId);
  if (!season) {
    throw new Error('Season not found');
  }
  const seasonBlackoutDates = season.blackoutDates ? JSON.stringify(season.blackoutDates) : null;

  // Get all division configs for this season
  const divisionConfigs = await listDivisionConfigsBySeasonId(db, seasonId);

  // Get all availabilities and overrides
  const [fieldAvailabilities, cageAvailabilities, fieldDateOverrides, cageDateOverrides] =
    await Promise.all([
      listFieldAvailabilitiesForSeason(db, seasonId),
      listCageAvailabilitiesForSeason(db, seasonId),
      listFieldDateOverridesForSeason(db, seasonId),
      listCageDateOverridesForSeason(db, seasonId),
    ]);

  // Create the saved config record
  await db
    .prepare(
      `INSERT INTO saved_configs (id, season_id, name, description, season_blackout_dates, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(savedConfigId, seasonId, name, description || null, seasonBlackoutDates, now, now)
    .run();

  // Save division configs
  if (divisionConfigs.length > 0) {
    for (let i = 0; i < divisionConfigs.length; i += BATCH_SIZE) {
      const batch = divisionConfigs.slice(i, i + BATCH_SIZE);
      const statements = batch.map((config) => {
        // Extract only the config fields we want to save (exclude id, seasonId, createdAt, updatedAt)
        const configData = {
          practicesPerWeek: config.practicesPerWeek,
          practiceDurationHours: config.practiceDurationHours,
          gamesPerWeek: config.gamesPerWeek,
          gameDurationHours: config.gameDurationHours,
          gameArriveBeforeHours: config.gameArriveBeforeHours,
          gameDayPreferences: config.gameDayPreferences,
          minConsecutiveDayGap: config.minConsecutiveDayGap,
          cageSessionsPerWeek: config.cageSessionsPerWeek,
          cageSessionDurationHours: config.cageSessionDurationHours,
          fieldPreferences: config.fieldPreferences,
          gameWeekOverrides: config.gameWeekOverrides,
          maxGamesPerSeason: config.maxGamesPerSeason,
          blackoutDates: config.blackoutDates,
          sundayPairedPracticeEnabled: config.sundayPairedPracticeEnabled,
          sundayPairedPracticeDurationHours: config.sundayPairedPracticeDurationHours,
          sundayPairedPracticeFieldId: config.sundayPairedPracticeFieldId,
          sundayPairedPracticeCageId: config.sundayPairedPracticeCageId,
          gameSpacingEnabled: config.gameSpacingEnabled,
        };
        return db
          .prepare(
            `INSERT INTO saved_config_division_configs (id, saved_config_id, division_id, config_json, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(generateId(), savedConfigId, config.divisionId, JSON.stringify(configData), now);
      });
      await db.batch(statements);
    }
  }

  // Save field availabilities
  if (fieldAvailabilities.length > 0) {
    for (let i = 0; i < fieldAvailabilities.length; i += BATCH_SIZE) {
      const batch = fieldAvailabilities.slice(i, i + BATCH_SIZE);
      const statements = batch.map((avail) =>
        db
          .prepare(
            `INSERT INTO saved_config_field_availabilities (id, saved_config_id, season_field_id, day_of_week, start_time, end_time, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(generateId(), savedConfigId, avail.seasonFieldId, avail.dayOfWeek, avail.startTime, avail.endTime, now)
      );
      await db.batch(statements);
    }
  }

  // Save cage availabilities
  if (cageAvailabilities.length > 0) {
    for (let i = 0; i < cageAvailabilities.length; i += BATCH_SIZE) {
      const batch = cageAvailabilities.slice(i, i + BATCH_SIZE);
      const statements = batch.map((avail) =>
        db
          .prepare(
            `INSERT INTO saved_config_cage_availabilities (id, saved_config_id, season_cage_id, day_of_week, start_time, end_time, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(generateId(), savedConfigId, avail.seasonCageId, avail.dayOfWeek, avail.startTime, avail.endTime, now)
      );
      await db.batch(statements);
    }
  }

  // Save field date overrides
  if (fieldDateOverrides.length > 0) {
    for (let i = 0; i < fieldDateOverrides.length; i += BATCH_SIZE) {
      const batch = fieldDateOverrides.slice(i, i + BATCH_SIZE);
      const statements = batch.map((override) =>
        db
          .prepare(
            `INSERT INTO saved_config_field_date_overrides (id, saved_config_id, season_field_id, date, override_type, start_time, end_time, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            generateId(),
            savedConfigId,
            override.seasonFieldId,
            override.date,
            override.overrideType,
            override.startTime || null,
            override.endTime || null,
            override.reason || null,
            now
          )
      );
      await db.batch(statements);
    }
  }

  // Save cage date overrides
  if (cageDateOverrides.length > 0) {
    for (let i = 0; i < cageDateOverrides.length; i += BATCH_SIZE) {
      const batch = cageDateOverrides.slice(i, i + BATCH_SIZE);
      const statements = batch.map((override) =>
        db
          .prepare(
            `INSERT INTO saved_config_cage_date_overrides (id, saved_config_id, season_cage_id, date, override_type, start_time, end_time, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            generateId(),
            savedConfigId,
            override.seasonCageId,
            override.date,
            override.overrideType,
            override.startTime || null,
            override.endTime || null,
            override.reason || null,
            now
          )
      );
      await db.batch(statements);
    }
  }

  const savedConfig = await getSavedConfigById(db, savedConfigId);
  if (!savedConfig) {
    throw new Error('Failed to create saved config');
  }

  return savedConfig;
}

/**
 * Restore a saved configuration
 */
export async function restoreConfig(
  db: D1Database,
  savedConfigId: string
): Promise<RestoreConfigResult> {
  // Get the saved config
  const savedConfigRow = await db
    .prepare('SELECT * FROM saved_configs WHERE id = ?')
    .bind(savedConfigId)
    .first<SavedConfigRow>();

  if (!savedConfigRow) {
    throw new Error('Saved config not found');
  }

  const seasonId = savedConfigRow.season_id;
  const now = new Date().toISOString();

  // Restore season blackout dates
  const seasonBlackoutDates: SeasonBlackout[] | undefined = savedConfigRow.season_blackout_dates
    ? JSON.parse(savedConfigRow.season_blackout_dates)
    : undefined;
  await updateSeason(db, seasonId, { blackoutDates: seasonBlackoutDates });

  // Get saved division configs
  const savedDivisionConfigs = await db
    .prepare('SELECT * FROM saved_config_division_configs WHERE saved_config_id = ?')
    .bind(savedConfigId)
    .all<SavedConfigDivisionConfigRow>();

  // Delete existing division configs and recreate
  await db.prepare('DELETE FROM division_configs WHERE season_id = ?').bind(seasonId).run();

  let divisionConfigsRestored = 0;
  const divisionConfigRows = savedDivisionConfigs.results || [];
  for (let i = 0; i < divisionConfigRows.length; i += BATCH_SIZE) {
    const batch = divisionConfigRows.slice(i, i + BATCH_SIZE);
    const statements = batch.map((row) => {
      const configData = JSON.parse(row.config_json);
      return db
        .prepare(
          `INSERT INTO division_configs (
            id, division_id, season_id,
            practices_per_week, practice_duration_hours, games_per_week, game_duration_hours,
            game_arrive_before_hours, game_day_preferences, min_consecutive_day_gap,
            cage_sessions_per_week, cage_session_duration_hours, field_preferences,
            game_week_overrides, max_games_per_season, blackout_dates,
            sunday_paired_practice_enabled, sunday_paired_practice_duration_hours,
            sunday_paired_practice_field_id, sunday_paired_practice_cage_id,
            game_spacing_enabled,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          generateId(),
          row.division_id,
          seasonId,
          configData.practicesPerWeek,
          configData.practiceDurationHours,
          configData.gamesPerWeek,
          configData.gameDurationHours,
          configData.gameArriveBeforeHours || null,
          configData.gameDayPreferences ? JSON.stringify(configData.gameDayPreferences) : null,
          configData.minConsecutiveDayGap || null,
          configData.cageSessionsPerWeek || null,
          configData.cageSessionDurationHours || null,
          configData.fieldPreferences ? JSON.stringify(configData.fieldPreferences) : null,
          configData.gameWeekOverrides ? JSON.stringify(configData.gameWeekOverrides) : null,
          configData.maxGamesPerSeason || null,
          configData.blackoutDates ? JSON.stringify(configData.blackoutDates) : null,
          configData.sundayPairedPracticeEnabled ? 1 : 0,
          configData.sundayPairedPracticeDurationHours || null,
          configData.sundayPairedPracticeFieldId || null,
          configData.sundayPairedPracticeCageId || null,
          configData.gameSpacingEnabled ? 1 : 0,
          now,
          now
        );
    });
    await db.batch(statements);
    divisionConfigsRestored += batch.length;
  }

  // Get season fields and cages for mapping
  const seasonFieldsResult = await db
    .prepare('SELECT id FROM season_fields WHERE season_id = ?')
    .bind(seasonId)
    .all<{ id: string }>();
  const seasonFieldIds = new Set((seasonFieldsResult.results || []).map((r) => r.id));

  const seasonCagesResult = await db
    .prepare('SELECT id FROM season_cages WHERE season_id = ?')
    .bind(seasonId)
    .all<{ id: string }>();
  const seasonCageIds = new Set((seasonCagesResult.results || []).map((r) => r.id));

  // Restore field availabilities
  const savedFieldAvailabilities = await db
    .prepare('SELECT * FROM saved_config_field_availabilities WHERE saved_config_id = ?')
    .bind(savedConfigId)
    .all<SavedConfigFieldAvailabilityRow>();

  // Delete existing and recreate (only for season fields that still exist)
  await db.prepare('DELETE FROM field_availabilities WHERE season_field_id IN (SELECT id FROM season_fields WHERE season_id = ?)').bind(seasonId).run();

  let fieldAvailabilitiesRestored = 0;
  const fieldAvailRows = (savedFieldAvailabilities.results || []).filter((r) => seasonFieldIds.has(r.season_field_id));
  for (let i = 0; i < fieldAvailRows.length; i += BATCH_SIZE) {
    const batch = fieldAvailRows.slice(i, i + BATCH_SIZE);
    const statements = batch.map((row) =>
      db
        .prepare(
          `INSERT INTO field_availabilities (id, season_field_id, day_of_week, start_time, end_time, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(generateId(), row.season_field_id, row.day_of_week, row.start_time, row.end_time, now, now)
    );
    await db.batch(statements);
    fieldAvailabilitiesRestored += batch.length;
  }

  // Restore cage availabilities
  const savedCageAvailabilities = await db
    .prepare('SELECT * FROM saved_config_cage_availabilities WHERE saved_config_id = ?')
    .bind(savedConfigId)
    .all<SavedConfigCageAvailabilityRow>();

  await db.prepare('DELETE FROM cage_availabilities WHERE season_cage_id IN (SELECT id FROM season_cages WHERE season_id = ?)').bind(seasonId).run();

  let cageAvailabilitiesRestored = 0;
  const cageAvailRows = (savedCageAvailabilities.results || []).filter((r) => seasonCageIds.has(r.season_cage_id));
  for (let i = 0; i < cageAvailRows.length; i += BATCH_SIZE) {
    const batch = cageAvailRows.slice(i, i + BATCH_SIZE);
    const statements = batch.map((row) =>
      db
        .prepare(
          `INSERT INTO cage_availabilities (id, season_cage_id, day_of_week, start_time, end_time, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(generateId(), row.season_cage_id, row.day_of_week, row.start_time, row.end_time, now, now)
    );
    await db.batch(statements);
    cageAvailabilitiesRestored += batch.length;
  }

  // Restore field date overrides
  const savedFieldDateOverrides = await db
    .prepare('SELECT * FROM saved_config_field_date_overrides WHERE saved_config_id = ?')
    .bind(savedConfigId)
    .all<SavedConfigFieldDateOverrideRow>();

  await db.prepare('DELETE FROM field_date_overrides WHERE season_field_id IN (SELECT id FROM season_fields WHERE season_id = ?)').bind(seasonId).run();

  let fieldDateOverridesRestored = 0;
  const fieldOverrideRows = (savedFieldDateOverrides.results || []).filter((r) => seasonFieldIds.has(r.season_field_id));
  for (let i = 0; i < fieldOverrideRows.length; i += BATCH_SIZE) {
    const batch = fieldOverrideRows.slice(i, i + BATCH_SIZE);
    const statements = batch.map((row) =>
      db
        .prepare(
          `INSERT INTO field_date_overrides (id, season_field_id, date, override_type, start_time, end_time, reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(generateId(), row.season_field_id, row.date, row.override_type, row.start_time, row.end_time, row.reason, now, now)
    );
    await db.batch(statements);
    fieldDateOverridesRestored += batch.length;
  }

  // Restore cage date overrides
  const savedCageDateOverrides = await db
    .prepare('SELECT * FROM saved_config_cage_date_overrides WHERE saved_config_id = ?')
    .bind(savedConfigId)
    .all<SavedConfigCageDateOverrideRow>();

  await db.prepare('DELETE FROM cage_date_overrides WHERE season_cage_id IN (SELECT id FROM season_cages WHERE season_id = ?)').bind(seasonId).run();

  let cageDateOverridesRestored = 0;
  const cageOverrideRows = (savedCageDateOverrides.results || []).filter((r) => seasonCageIds.has(r.season_cage_id));
  for (let i = 0; i < cageOverrideRows.length; i += BATCH_SIZE) {
    const batch = cageOverrideRows.slice(i, i + BATCH_SIZE);
    const statements = batch.map((row) =>
      db
        .prepare(
          `INSERT INTO cage_date_overrides (id, season_cage_id, date, override_type, start_time, end_time, reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(generateId(), row.season_cage_id, row.date, row.override_type, row.start_time, row.end_time, row.reason, now, now)
    );
    await db.batch(statements);
    cageDateOverridesRestored += batch.length;
  }

  return {
    divisionConfigsRestored,
    fieldAvailabilitiesRestored,
    cageAvailabilitiesRestored,
    fieldDateOverridesRestored,
    cageDateOverridesRestored,
  };
}

/**
 * Delete a saved config (cascade deletes all related data)
 */
export async function deleteSavedConfig(
  db: D1Database,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM saved_configs WHERE id = ?')
    .bind(id)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
