import type { D1Database } from '@cloudflare/workers-types';
import type {
  GenerateScheduleRequest,
  GenerateScheduleResult,
  ScheduledEventDraft,
} from '@ll-scheduler/shared';
import { ScheduleGenerator } from './generator.js';
import { getSeasonPhaseById } from '../season-phases.js';
import { listDivisionConfigs } from '../division-configs.js';
import { listTeams } from '../teams.js';
import { listFields } from '../fields.js';
import { listBattingCages } from '../batting-cages.js';
import { listFieldAvailability } from '../field-availability.js';
import { listCageAvailability } from '../cage-availability.js';
import { listFieldDateOverrides } from '../field-date-overrides.js';
import { listCageDateOverrides } from '../cage-date-overrides.js';
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
    // Fetch the season phase
    const phase = await getSeasonPhaseById(db, request.seasonPhaseId);
    if (!phase) {
      return {
        success: false,
        eventsCreated: 0,
        message: 'Season phase not found',
        errors: [{ type: 'invalid_config', message: 'Season phase not found' }],
      };
    }

    // Fetch all necessary data
    const [
      divisionConfigs,
      teams,
      fields,
      cages,
      fieldAvailability,
      cageAvailability,
      fieldOverrides,
      cageOverrides,
    ] = await Promise.all([
      listDivisionConfigs(db, { seasonId: phase.seasonId }),
      listTeams(db, { seasonId: phase.seasonId }),
      listFields(db),
      listBattingCages(db),
      listFieldAvailability(db),
      listCageAvailability(db),
      listFieldDateOverrides(db),
      listCageDateOverrides(db),
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
        seasonPhaseId: request.seasonPhaseId,
      });

      for (const event of existingEvents) {
        await deleteScheduledEvent(db, event.id);
      }
    }

    // Create the generator
    const generator = new ScheduleGenerator(
      phase,
      filteredConfigs,
      filteredTeams,
      fields,
      cages,
      fieldAvailability,
      cageAvailability,
      fieldOverrides,
      cageOverrides
    );

    // Generate the schedule
    const result = await generator.generate();

    // Save the generated events to the database
    if (result.success) {
      const events = generator.getScheduledEvents();
      await saveScheduledEvents(db, events);
    }

    return result;
  } catch (error) {
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
    await createScheduledEvent(db, {
      seasonPhaseId: event.seasonPhaseId,
      divisionId: event.divisionId,
      eventType: event.eventType,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      status: 'scheduled',
      fieldId: event.fieldId,
      cageId: event.cageId,
      homeTeamId: event.homeTeamId,
      awayTeamId: event.awayTeamId,
      teamId: event.teamId,
    });
  }
}
