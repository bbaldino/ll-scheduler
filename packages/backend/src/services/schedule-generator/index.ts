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
import {
  listScheduledEvents,
  createScheduledEvent,
  deleteScheduledEvent,
} from '../scheduled-events.js';

/**
 * Main service for generating schedules
 */
export async function generateSchedule(
  db: D1Database,
  request: GenerateScheduleRequest
): Promise<GenerateScheduleResult> {
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

    // Filter teams by division if specified
    const filteredTeams = request.divisionIds
      ? teams.filter((t) => request.divisionIds!.includes(t.divisionId))
      : teams;

    // Filter division configs to match teams
    const relevantDivisionIds = new Set(filteredTeams.map((t) => t.divisionId));
    const filteredConfigs = divisionConfigs.filter((dc) =>
      relevantDivisionIds.has(dc.divisionId)
    );

    // Clear existing events if requested
    if (request.clearExisting) {
      const existingEvents = await listScheduledEvents(db, {
        seasonId: request.seasonId,
      });

      for (const event of existingEvents) {
        await deleteScheduledEvent(db, event.id);
      }
    }

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

    // Generate the schedule
    verboseLog('generateSchedule: Calling generator.generate()');
    const result = await generator.generate();
    verboseLog('generateSchedule: Generator result:', JSON.stringify(result, null, 2));

    // Save the generated events to the database
    if (result.success) {
      const events = generator.getScheduledEvents();
      verboseLog('generateSchedule: Saving', events.length, 'events to database');
      await saveScheduledEvents(db, events);
      verboseLog('generateSchedule: Events saved successfully');
    } else {
      verboseLog('generateSchedule: Generation failed, not saving events');
    }

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
 * Save generated events to the database
 */
async function saveScheduledEvents(
  db: D1Database,
  events: ScheduledEventDraft[]
): Promise<void> {
  for (const event of events) {
    const input = {
      seasonId: event.seasonId,
      divisionId: event.divisionId,
      eventType: event.eventType,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      status: 'scheduled' as const,
      fieldId: event.fieldId,
      cageId: event.cageId,
      homeTeamId: event.homeTeamId,
      awayTeamId: event.awayTeamId,
      teamId: event.teamId,
    };
    await createScheduledEvent(db, input);
  }
}
