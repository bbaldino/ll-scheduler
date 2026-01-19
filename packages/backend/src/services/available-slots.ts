import type {
  AvailableSlot,
  AvailableSlotsResponse,
  SeasonField,
  SeasonCage,
  FieldAvailability,
  CageAvailability,
  FieldDateOverride,
  CageDateOverride,
  Season,
} from '@ll-scheduler/shared';
import { listSeasonFields } from './season-fields.js';
import { listSeasonCages } from './season-cages.js';
import { listFieldAvailabilitiesForSeason } from './field-availabilities.js';
import { listCageAvailabilitiesForSeason } from './cage-availabilities.js';
import { listFieldDateOverridesForSeason } from './field-date-overrides.js';
import { listCageDateOverridesForSeason } from './cage-date-overrides.js';
import { getSeasonById } from './seasons.js';
import {
  getDateRange,
  getDayOfWeek,
  timeToMinutes,
  minutesToTime,
} from './schedule-generator/constraints.js';

/**
 * Get available time slots for fields and cages within a date range.
 * Optionally filter by division compatibility.
 */
export async function getAvailableSlots(
  db: D1Database,
  seasonId: string,
  startDate: string,
  endDate: string,
  divisionId?: string
): Promise<AvailableSlotsResponse> {
  // Load all required data
  const [
    season,
    seasonFields,
    seasonCages,
    fieldAvailabilities,
    cageAvailabilities,
    fieldOverrides,
    cageOverrides,
  ] = await Promise.all([
    getSeasonById(db, seasonId),
    listSeasonFields(db, seasonId),
    listSeasonCages(db, seasonId),
    listFieldAvailabilitiesForSeason(db, seasonId),
    listCageAvailabilitiesForSeason(db, seasonId),
    listFieldDateOverridesForSeason(db, seasonId),
    listCageDateOverridesForSeason(db, seasonId),
  ]);

  if (!season) {
    return { fieldSlots: [], cageSlots: [] };
  }

  // Filter fields/cages by division compatibility if divisionId provided
  const filteredFields = divisionId
    ? seasonFields.filter((sf) =>
        sf.field?.divisionCompatibility?.includes(divisionId)
      )
    : seasonFields;

  const filteredCages = divisionId
    ? seasonCages.filter((sc) =>
        sc.cage?.divisionCompatibility?.includes(divisionId)
      )
    : seasonCages;

  // Get all dates in the range
  const dates = getDateRange(startDate, endDate);

  // Build field slots
  const fieldSlots = buildFieldSlots(
    dates,
    filteredFields,
    fieldAvailabilities,
    fieldOverrides,
    season,
    divisionId
  );

  // Build cage slots
  const cageSlots = buildCageSlots(
    dates,
    filteredCages,
    cageAvailabilities,
    cageOverrides,
    season,
    divisionId
  );

  return { fieldSlots, cageSlots };
}

/**
 * Check if a date is blacked out by season-level blackouts
 */
function isDateBlackedOut(
  date: string,
  season: Season,
  eventTypes: ('game' | 'practice' | 'cage')[] | 'all',
  divisionId?: string
): boolean {
  const blackouts = season.blackoutDates || [];

  for (const blackout of blackouts) {
    // Check if date falls within the blackout range
    const startDate = blackout.date;
    const endDate = blackout.endDate || blackout.date;

    if (date < startDate || date > endDate) {
      continue;
    }

    // Check if division matches (if blackout is division-specific)
    if (blackout.divisionIds && blackout.divisionIds.length > 0) {
      if (!divisionId || !blackout.divisionIds.includes(divisionId)) {
        continue;
      }
    }

    // Check if event type is blocked
    const blockedTypes = blackout.blockedEventTypes;
    if (!blockedTypes || blockedTypes.length === 0) {
      // All types blocked
      return true;
    }

    if (eventTypes === 'all') {
      // For 'all', any blocked type counts
      return true;
    }

    // Check if any of our event types are blocked
    for (const eventType of eventTypes) {
      if (blockedTypes.includes(eventType)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Apply a blackout override to a time window, returning remaining usable windows
 */
function applyBlackoutToTimeWindow(
  windowStart: string,
  windowEnd: string,
  blackoutStart: string | undefined,
  blackoutEnd: string | undefined
): Array<{ startTime: string; endTime: string }> {
  // If blackout has no times, it blocks the entire day
  if (!blackoutStart || !blackoutEnd) {
    return [];
  }

  const windowStartMins = timeToMinutes(windowStart);
  const windowEndMins = timeToMinutes(windowEnd);
  const blackoutStartMins = timeToMinutes(blackoutStart);
  const blackoutEndMins = timeToMinutes(blackoutEnd);

  // If blackout doesn't overlap with window, return full window
  if (blackoutEndMins <= windowStartMins || blackoutStartMins >= windowEndMins) {
    return [{ startTime: windowStart, endTime: windowEnd }];
  }

  const result: Array<{ startTime: string; endTime: string }> = [];

  // Time before the blackout
  if (blackoutStartMins > windowStartMins) {
    result.push({
      startTime: windowStart,
      endTime: minutesToTime(Math.min(blackoutStartMins, windowEndMins)),
    });
  }

  // Time after the blackout
  if (blackoutEndMins < windowEndMins) {
    result.push({
      startTime: minutesToTime(Math.max(blackoutEndMins, windowStartMins)),
      endTime: windowEnd,
    });
  }

  return result;
}

/**
 * Build available field slots for given dates
 */
function buildFieldSlots(
  dates: string[],
  seasonFields: SeasonField[],
  availabilities: FieldAvailability[],
  overrides: FieldDateOverride[],
  season: Season,
  divisionId?: string
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];

  for (const date of dates) {
    // Skip if globally blacked out for practice/game (fields can be used for both)
    if (isDateBlackedOut(date, season, ['practice', 'game'], divisionId)) {
      continue;
    }

    const dayOfWeek = getDayOfWeek(date);

    for (const seasonField of seasonFields) {
      const fieldAvailabilities = availabilities.filter(
        (a) => a.seasonFieldId === seasonField.id && a.dayOfWeek === dayOfWeek
      );

      // Check for "added" overrides
      const addedOverride = overrides.find(
        (o) =>
          o.seasonFieldId === seasonField.id &&
          o.date === date &&
          o.overrideType === 'added'
      );

      // If no regular availability but there's an "added" override, use the override
      if (
        fieldAvailabilities.length === 0 &&
        addedOverride &&
        addedOverride.startTime &&
        addedOverride.endTime
      ) {
        slots.push({
          resourceType: 'field',
          resourceId: seasonField.fieldId,
          resourceName: seasonField.field?.name || seasonField.fieldId,
          date,
          startTime: addedOverride.startTime,
          endTime: addedOverride.endTime,
        });
        continue;
      }

      for (const avail of fieldAvailabilities) {
        const override = overrides.find(
          (o) => o.seasonFieldId === seasonField.id && o.date === date
        );

        // Handle blackout overrides
        if (override?.overrideType === 'blackout') {
          const remainingWindows = applyBlackoutToTimeWindow(
            avail.startTime,
            avail.endTime,
            override.startTime,
            override.endTime
          );

          for (const window of remainingWindows) {
            slots.push({
              resourceType: 'field',
              resourceId: seasonField.fieldId,
              resourceName: seasonField.field?.name || seasonField.fieldId,
              date,
              startTime: window.startTime,
              endTime: window.endTime,
            });
          }
          continue;
        }

        // Use override times if available, otherwise use regular availability
        const startTime = override?.startTime || avail.startTime;
        const endTime = override?.endTime || avail.endTime;

        slots.push({
          resourceType: 'field',
          resourceId: seasonField.fieldId,
          resourceName: seasonField.field?.name || seasonField.fieldId,
          date,
          startTime,
          endTime,
        });
      }
    }
  }

  return slots;
}

/**
 * Build available cage slots for given dates
 */
function buildCageSlots(
  dates: string[],
  seasonCages: SeasonCage[],
  availabilities: CageAvailability[],
  overrides: CageDateOverride[],
  season: Season,
  divisionId?: string
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];

  for (const date of dates) {
    // Skip if globally blacked out for cage sessions
    if (isDateBlackedOut(date, season, ['cage'], divisionId)) {
      continue;
    }

    const dayOfWeek = getDayOfWeek(date);

    for (const seasonCage of seasonCages) {
      const cageAvailabilities = availabilities.filter(
        (a) => a.seasonCageId === seasonCage.id && a.dayOfWeek === dayOfWeek
      );

      // Check for "added" overrides
      const addedOverride = overrides.find(
        (o) =>
          o.seasonCageId === seasonCage.id &&
          o.date === date &&
          o.overrideType === 'added'
      );

      // If no regular availability but there's an "added" override, use the override
      if (
        cageAvailabilities.length === 0 &&
        addedOverride &&
        addedOverride.startTime &&
        addedOverride.endTime
      ) {
        slots.push({
          resourceType: 'cage',
          resourceId: seasonCage.cageId,
          resourceName: seasonCage.cage?.name || seasonCage.cageId,
          date,
          startTime: addedOverride.startTime,
          endTime: addedOverride.endTime,
        });
        continue;
      }

      for (const avail of cageAvailabilities) {
        const override = overrides.find(
          (o) => o.seasonCageId === seasonCage.id && o.date === date
        );

        // Handle blackout overrides
        if (override?.overrideType === 'blackout') {
          const remainingWindows = applyBlackoutToTimeWindow(
            avail.startTime,
            avail.endTime,
            override.startTime,
            override.endTime
          );

          for (const window of remainingWindows) {
            slots.push({
              resourceType: 'cage',
              resourceId: seasonCage.cageId,
              resourceName: seasonCage.cage?.name || seasonCage.cageId,
              date,
              startTime: window.startTime,
              endTime: window.endTime,
            });
          }
          continue;
        }

        // Use override times if available, otherwise use regular availability
        const startTime = override?.startTime || avail.startTime;
        const endTime = override?.endTime || avail.endTime;

        slots.push({
          resourceType: 'cage',
          resourceId: seasonCage.cageId,
          resourceName: seasonCage.cage?.name || seasonCage.cageId,
          date,
          startTime,
          endTime,
        });
      }
    }
  }

  return slots;
}
