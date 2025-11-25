import type { D1Database } from '@cloudflare/workers-types';
import type {
  GenerateScheduleRequest,
  GenerateScheduleResult,
  ScheduledEventDraft,
} from '@ll-scheduler/shared';
import { ScheduleGenerator } from './generator.js';
import { getSeasonPeriodsByIds } from '../season-periods.js';
import { getSeasonById } from '../seasons.js';
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
    console.log('generateSchedule: Starting with request:', JSON.stringify(request, null, 2));

    // Validate period IDs
    if (!request.periodIds || request.periodIds.length === 0) {
      return {
        success: false,
        eventsCreated: 0,
        message: 'No season periods specified',
        errors: [{ type: 'invalid_config', message: 'At least one season period must be selected' }],
      };
    }

    // Fetch the season periods
    console.log('generateSchedule: Fetching season periods:', request.periodIds);
    const periods = await getSeasonPeriodsByIds(db, request.periodIds);
    if (periods.length === 0) {
      console.log('generateSchedule: No season periods found');
      return {
        success: false,
        eventsCreated: 0,
        message: 'Season periods not found',
        errors: [{ type: 'invalid_config', message: 'Season periods not found' }],
      };
    }
    console.log('generateSchedule: Found', periods.length, 'season periods');

    // All periods must belong to the same season
    const seasonIds = new Set(periods.map(p => p.seasonId));
    if (seasonIds.size > 1) {
      return {
        success: false,
        eventsCreated: 0,
        message: 'All periods must belong to the same season',
        errors: [{ type: 'invalid_config', message: 'Cannot generate schedule across multiple seasons' }],
      };
    }

    const seasonId = periods[0].seasonId;

    // Fetch the season
    const season = await getSeasonById(db, seasonId);
    if (!season) {
      console.log('generateSchedule: Season not found');
      return {
        success: false,
        eventsCreated: 0,
        message: 'Season not found',
        errors: [{ type: 'invalid_config', message: 'Season not found' }],
      };
    }
    console.log('generateSchedule: Found season:', JSON.stringify(season, null, 2));

    // Fetch all necessary data
    const [
      divisionConfigs,
      teams,
      seasonFields,
      seasonCages,
      fieldAvailability,
      cageAvailability,
      fieldOverrides,
      cageOverrides,
    ] = await Promise.all([
      listDivisionConfigsBySeasonId(db, seasonId),
      listTeams(db, seasonId),
      listSeasonFields(db, seasonId),
      listSeasonCages(db, seasonId),
      listFieldAvailabilitiesForSeason(db, seasonId),
      listCageAvailabilitiesForSeason(db, seasonId),
      listFieldDateOverridesForSeason(db, seasonId),
      listCageDateOverridesForSeason(db, seasonId),
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
        seasonPeriodIds: request.periodIds,
      });

      for (const event of existingEvents) {
        await deleteScheduledEvent(db, event.id);
      }
    }

    // Create the generator with the selected periods
    const generator = new ScheduleGenerator(
      periods,
      season,
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
    console.log('generateSchedule: Calling generator.generate()');
    const result = await generator.generate();
    console.log('generateSchedule: Generator result:', JSON.stringify(result, null, 2));

    // Save the generated events to the database
    if (result.success) {
      const events = generator.getScheduledEvents();
      console.log('generateSchedule: Saving', events.length, 'events to database');
      await saveScheduledEvents(db, events);
      console.log('generateSchedule: Events saved successfully');
    } else {
      console.log('generateSchedule: Generation failed, not saving events');
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
      seasonPeriodId: event.seasonPeriodId,
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
