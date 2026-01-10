import type { D1Database } from '@cloudflare/workers-types';
import type {
  GenerateScheduleRequest,
  GenerateScheduleResult,
  ScheduledEventDraft,
} from '@ll-scheduler/shared';
import { ScheduleGenerator } from './generator.js';

// Verbose logging - set to true to enable detailed console output
const VERBOSE_LOGGING = false;
function verboseLog(...args: unknown[]): void {
  if (VERBOSE_LOGGING) {
    verboseLog(...args);
  }
}
import { getSeasonById } from '../seasons.js';
import { listDivisions } from '../divisions.js';
import { listDivisionConfigsBySeasonId } from '../division-configs.js';
import { listTeams } from '../teams.js';
import { listSeasonFields } from '../season-fields.js';
import { listSeasonCages } from '../season-cages.js';
import { listFieldAvailabilitiesForSeason } from '../field-availabilities.js';
import { listCageAvailabilitiesForSeason } from '../cage-availabilities.js';
import { listFieldDateOverridesForSeason } from '../field-date-overrides.js';
import { listCageDateOverridesForSeason } from '../cage-date-overrides.js';
import { listScheduledEvents } from '../scheduled-events.js';
import { generateId } from '../../utils/id.js';

// D1 batch size limit - use conservative value to stay well under limits
const BATCH_SIZE = 50;

/**
 * Main service for generating schedules
 */
export async function generateSchedule(
  db: D1Database,
  request: GenerateScheduleRequest
): Promise<GenerateScheduleResult> {
  const timings: Record<string, number> = {};
  let startTime = Date.now();

  try {
    verboseLog('generateSchedule: Starting with request:', JSON.stringify(request, null, 2));

    // Validate season ID
    if (!request.seasonId) {
      return {
        success: false,
        eventsCreated: 0,
        message: 'No season specified',
        errors: [{ type: 'invalid_config', message: 'A season ID must be provided' }],
      };
    }

    // Fetch the season
    verboseLog('generateSchedule: Fetching season:', request.seasonId);
    const season = await getSeasonById(db, request.seasonId);
    if (!season) {
      verboseLog('generateSchedule: Season not found');
      return {
        success: false,
        eventsCreated: 0,
        message: 'Season not found',
        errors: [{ type: 'invalid_config', message: 'Season not found' }],
      };
    }
    verboseLog('generateSchedule: Found season:', JSON.stringify(season, null, 2));

    timings['fetchSeason'] = Date.now() - startTime;
    startTime = Date.now();

    // Fetch all necessary data
    const [
      divisions,
      divisionConfigs,
      teams,
      seasonFields,
      seasonCages,
      fieldAvailability,
      cageAvailability,
      fieldOverrides,
      cageOverrides,
    ] = await Promise.all([
      listDivisions(db),
      listDivisionConfigsBySeasonId(db, request.seasonId),
      listTeams(db, request.seasonId),
      listSeasonFields(db, request.seasonId),
      listSeasonCages(db, request.seasonId),
      listFieldAvailabilitiesForSeason(db, request.seasonId),
      listCageAvailabilitiesForSeason(db, request.seasonId),
      listFieldDateOverridesForSeason(db, request.seasonId),
      listCageDateOverridesForSeason(db, request.seasonId),
    ]);

    timings['fetchAllData'] = Date.now() - startTime;
    startTime = Date.now();

    // Filter teams by division if specified
    const filteredTeams = request.divisionIds
      ? teams.filter((t) => request.divisionIds!.includes(t.divisionId))
      : teams;

    // Filter division configs to match teams
    const relevantDivisionIds = new Set(filteredTeams.map((t) => t.divisionId));
    const filteredConfigs = divisionConfigs.filter((dc) =>
      relevantDivisionIds.has(dc.divisionId)
    );

    // Load existing events for this season
    const existingEvents = await listScheduledEvents(db, {
      seasonId: request.seasonId,
      // If specific divisions requested, only load events for those divisions
      ...(request.divisionIds && request.divisionIds.length > 0
        ? { divisionId: request.divisionIds[0] } // Note: listScheduledEvents only supports single divisionId filter
        : {}),
    });

    // Filter to requested divisions if multiple were specified
    const filteredExistingEvents = request.divisionIds && request.divisionIds.length > 1
      ? existingEvents.filter(e => request.divisionIds!.includes(e.divisionId))
      : existingEvents;

    // Clear existing events if requested (using batch for efficiency)
    if (request.clearExisting) {
      if (filteredExistingEvents.length > 0) {
        const deleteStatements = filteredExistingEvents.map((event) =>
          db.prepare('DELETE FROM scheduled_events WHERE id = ?').bind(event.id)
        );
        // Batch in chunks to avoid D1 limits
        for (let i = 0; i < deleteStatements.length; i += BATCH_SIZE) {
          const chunk = deleteStatements.slice(i, i + BATCH_SIZE);
          await db.batch(chunk);
        }
      }
    }

    timings['clearExisting'] = Date.now() - startTime;
    startTime = Date.now();

    // Create the generator
    const generator = new ScheduleGenerator(
      season,
      divisions,
      filteredConfigs,
      filteredTeams,
      seasonFields,
      seasonCages,
      fieldAvailability,
      cageAvailability,
      fieldOverrides,
      cageOverrides
    );

    timings['createGenerator'] = Date.now() - startTime;
    startTime = Date.now();

    // If not clearing existing events, initialize the generator with them
    // so it works around pre-scheduled events
    if (!request.clearExisting && filteredExistingEvents.length > 0) {
      verboseLog(`generateSchedule: Initializing with ${filteredExistingEvents.length} existing events`);
      generator.initializeWithExistingEvents(filteredExistingEvents);
    }

    timings['initExisting'] = Date.now() - startTime;
    startTime = Date.now();

    // Generate the schedule
    verboseLog('generateSchedule: Calling generator.generate()');
    const result = await generator.generate();
    verboseLog('generateSchedule: Generator result:', JSON.stringify(result, null, 2));

    timings['generate'] = Date.now() - startTime;
    startTime = Date.now();

    // Save the generated events to the database
    if (result.success) {
      const events = generator.getScheduledEvents();
      verboseLog('generateSchedule: Saving', events.length, 'events to database');
      await saveScheduledEvents(db, events);
      verboseLog('generateSchedule: Events saved successfully');
    } else {
      verboseLog('generateSchedule: Generation failed, not saving events');
    }

    timings['saveEvents'] = Date.now() - startTime;
    console.log('TIMINGS:', JSON.stringify(timings));

    return result;
  } catch (error) {
    console.error('generateSchedule: Exception caught:', error);
    console.error('generateSchedule: Stack trace:', error instanceof Error ? error.stack : 'N/A');
    return {
      success: false,
      eventsCreated: 0,
      message: 'Schedule generation failed',
      errors: [
        {
          type: 'generation_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
    };
  }
}

/**
 * Save generated events to the database using batch insert for efficiency
 */
async function saveScheduledEvents(
  db: D1Database,
  events: ScheduledEventDraft[]
): Promise<void> {
  if (events.length === 0) return;

  const now = new Date().toISOString();

  const insertStatements = events.map((event) => {
    const id = generateId();
    return db
      .prepare(
        `INSERT INTO scheduled_events (
          id, season_id, division_id, event_type, date, start_time, end_time,
          status, notes, field_id, cage_id, home_team_id, away_team_id, team_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        event.seasonId,
        event.divisionId,
        event.eventType,
        event.date,
        event.startTime,
        event.endTime,
        'scheduled',
        null,
        event.fieldId || null,
        event.cageId || null,
        event.homeTeamId || null,
        event.awayTeamId || null,
        event.teamId || null,
        now,
        now
      );
  });

  // Batch in chunks to avoid D1 limits
  for (let i = 0; i < insertStatements.length; i += BATCH_SIZE) {
    const chunk = insertStatements.slice(i, i + BATCH_SIZE);
    await db.batch(chunk);
  }
}
