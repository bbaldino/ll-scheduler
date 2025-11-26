import type {
  TimeSlot,
  ResourceSlot,
  ScheduledEventDraft,
  TeamConstraint,
} from '@ll-scheduler/shared';
import { parseLocalDate, formatDateStr } from './draft.js';

/**
 * Check if a time slot conflicts with an existing event
 */
export function hasTimeConflict(
  slot: TimeSlot,
  resourceId: string,
  resourceType: 'field' | 'cage',
  existingEvents: ScheduledEventDraft[]
): boolean {
  return existingEvents.some((event) => {
    // Check if same resource
    const sameResource =
      (resourceType === 'field' && event.fieldId === resourceId) ||
      (resourceType === 'cage' && event.cageId === resourceId);

    if (!sameResource || event.date !== slot.date) {
      return false;
    }

    // Check for time overlap
    return timesOverlap(event.startTime, event.endTime, slot.startTime, slot.endTime);
  });
}

/**
 * Check if two time ranges overlap
 */
export function timesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * Check if a team has a conflict on the given date/time
 */
export function teamHasConflict(
  teamId: string,
  slot: TimeSlot,
  existingEvents: ScheduledEventDraft[]
): boolean {
  return existingEvents.some((event) => {
    // Check if team is involved in this event
    const isInvolved =
      event.teamId === teamId ||
      event.homeTeamId === teamId ||
      event.awayTeamId === teamId;

    if (!isInvolved || event.date !== slot.date) {
      return false;
    }

    // Check for time overlap
    return timesOverlap(event.startTime, event.endTime, slot.startTime, slot.endTime);
  });
}

/**
 * Check if scheduling this event would violate minimum day gap constraint
 */
export function violatesMinDayGap(
  teamId: string,
  date: string,
  minDays: number,
  existingEvents: ScheduledEventDraft[]
): boolean {
  if (minDays <= 0) return false;

  const teamEvents = existingEvents.filter(
    (e) =>
      e.teamId === teamId || e.homeTeamId === teamId || e.awayTeamId === teamId
  );

  const targetDate = parseLocalDate(date);

  return teamEvents.some((event) => {
    const eventDate = parseLocalDate(event.date);
    const daysDiff = Math.abs(
      (targetDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysDiff < minDays && daysDiff > 0;
  });
}

/**
 * Parse HH:MM time string to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight to HH:MM string
 */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Calculate duration in hours between two times
 */
export function calculateDuration(startTime: string, endTime: string): number {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  return (endMinutes - startMinutes) / 60;
}

/**
 * Check if a slot has the required duration (with small tolerance)
 */
export function slotHasRequiredDuration(
  slot: TimeSlot,
  requiredHours: number,
  toleranceMinutes: number = 15
): boolean {
  const slotDuration = calculateDuration(slot.startTime, slot.endTime);
  const tolerance = toleranceMinutes / 60;
  return Math.abs(slotDuration - requiredHours) <= tolerance;
}

/**
 * Count how many events of a specific type a team already has
 */
export function countTeamEvents(
  teamId: string,
  eventType: 'game' | 'practice' | 'cage',
  existingEvents: ScheduledEventDraft[]
): number {
  return existingEvents.filter((event) => {
    if (event.eventType !== eventType) return false;

    return (
      event.teamId === teamId ||
      event.homeTeamId === teamId ||
      event.awayTeamId === teamId
    );
  }).length;
}

/**
 * Get all dates in a date range
 */
export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  while (current <= end) {
    dates.push(formatDateStr(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Get day of week for a date (0 = Sunday, 6 = Saturday)
 * Uses parseLocalDate to avoid timezone issues
 */
export function getDayOfWeek(date: string): number {
  return parseLocalDate(date).getDay();
}

/**
 * Check if a team is available for the given slot based on constraints
 */
export function isTeamAvailable(
  teamId: string,
  slot: TimeSlot,
  constraint: TeamConstraint,
  existingEvents: ScheduledEventDraft[]
): boolean {
  // Check for time conflicts
  if (teamHasConflict(teamId, slot, existingEvents)) {
    return false;
  }

  // Check minimum day gap
  if (
    constraint.minDaysBetweenEvents &&
    violatesMinDayGap(
      teamId,
      slot.date,
      constraint.minDaysBetweenEvents,
      existingEvents
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Check if both teams in a matchup are available for the slot
 */
export function areTeamsAvailableForMatchup(
  homeTeamId: string,
  awayTeamId: string,
  slot: TimeSlot,
  constraints: Map<string, TeamConstraint>,
  existingEvents: ScheduledEventDraft[]
): boolean {
  const homeConstraint = constraints.get(homeTeamId);
  const awayConstraint = constraints.get(awayTeamId);

  if (!homeConstraint || !awayConstraint) {
    return false;
  }

  return (
    isTeamAvailable(homeTeamId, slot, homeConstraint, existingEvents) &&
    isTeamAvailable(awayTeamId, slot, awayConstraint, existingEvents)
  );
}
