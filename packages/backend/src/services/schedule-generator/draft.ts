import type {
  PlacementCandidate,
  ScoredCandidate,
  ScoringWeights,
  TeamSchedulingState,
  ScheduledEventDraft,
  WeekDefinition,
  ResourceSlot,
  GameMatchup,
} from '@ll-scheduler/shared';
import type { EventType } from '@ll-scheduler/shared';
import { calculatePlacementScore, ScoringContext, updateResourceUsage } from './scoring.js';

/**
 * Rotate an array by n positions
 * [A, B, C] rotated by 1 becomes [B, C, A]
 */
export function rotateArray<T>(arr: T[], n: number): T[] {
  if (arr.length === 0) return arr;
  const offset = n % arr.length;
  return [...arr.slice(offset), ...arr.slice(0, offset)];
}

/**
 * Shuffle an array using a seeded random number generator
 * Uses a simple LCG for reproducibility
 */
export function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;

  // Simple LCG random number generator
  const random = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };

  // Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/**
 * Parse a date string (YYYY-MM-DD) into a Date object at noon local time.
 * This avoids timezone issues where UTC midnight becomes the previous day in local time.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Format a Date object to YYYY-MM-DD string
 */
export function formatDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get day of week (0=Sunday, 6=Saturday) from a date string, handling timezone correctly
 */
export function getDayOfWeekFromDateStr(dateStr: string): number {
  return parseLocalDate(dateStr).getDay();
}

/**
 * Generate week definitions from a date range
 * Weeks run Monday through Sunday
 */
export function generateWeekDefinitions(startDate: string, endDate: string): WeekDefinition[] {
  const weeks: WeekDefinition[] = [];
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  // Adjust start to the Monday of the week containing startDate
  // getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
  // For Monday-based weeks: Sunday goes back 6 days, other days go back (day-1) days
  const dayOfWeek = start.getDay();
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  start.setDate(start.getDate() - daysToSubtract);

  let weekNumber = 0;
  while (start <= end) {
    const weekStart = new Date(start);
    const weekEnd = new Date(start);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const dates: string[] = [];
    const current = new Date(weekStart);
    while (current <= weekEnd && current <= end) {
      dates.push(formatDateStr(current));
      current.setDate(current.getDate() + 1);
    }

    // Only include weeks that have at least one date in range
    if (dates.length > 0) {
      weeks.push({
        weekNumber,
        startDate: formatDateStr(weekStart),
        endDate: formatDateStr(weekEnd),
        dates,
      });
      weekNumber++;
    }

    start.setDate(start.getDate() + 7);
  }

  return weeks;
}

/**
 * Initialize team scheduling state
 */
export function initializeTeamState(
  teamId: string,
  teamName: string,
  divisionId: string,
  requirements: {
    totalGamesNeeded: number;
    totalPracticesNeeded: number;
    totalCagesNeeded: number;
    minDaysBetweenEvents: number;
  }
): TeamSchedulingState {
  return {
    teamId,
    teamName,
    divisionId,
    totalGamesNeeded: requirements.totalGamesNeeded,
    totalPracticesNeeded: requirements.totalPracticesNeeded,
    totalCagesNeeded: requirements.totalCagesNeeded,
    gamesScheduled: 0,
    practicesScheduled: 0,
    cagesScheduled: 0,
    eventsPerWeek: new Map(),
    dayOfWeekUsage: new Map(),
    homeGames: 0,
    awayGames: 0,
    fieldDatesUsed: new Set(),
    cageDatesUsed: new Set(),
    minDaysBetweenEvents: requirements.minDaysBetweenEvents,
  };
}

/**
 * Update team state after scheduling an event
 */
export function updateTeamStateAfterScheduling(
  teamState: TeamSchedulingState,
  event: ScheduledEventDraft,
  weekNumber: number,
  isHomeTeam?: boolean
): void {
  // Update event type counts
  switch (event.eventType) {
    case 'game':
      teamState.gamesScheduled++;
      if (isHomeTeam !== undefined) {
        if (isHomeTeam) {
          teamState.homeGames++;
        } else {
          teamState.awayGames++;
        }
      }
      break;
    case 'practice':
      teamState.practicesScheduled++;
      break;
    case 'cage':
      teamState.cagesScheduled++;
      break;
  }

  // Update week tracking
  if (!teamState.eventsPerWeek.has(weekNumber)) {
    teamState.eventsPerWeek.set(weekNumber, { games: 0, practices: 0, cages: 0 });
  }
  const weekEvents = teamState.eventsPerWeek.get(weekNumber)!;
  switch (event.eventType) {
    case 'game':
      weekEvents.games++;
      break;
    case 'practice':
      weekEvents.practices++;
      break;
    case 'cage':
      weekEvents.cages++;
      break;
  }

  // Update day of week usage
  const dayOfWeek = getDayOfWeekFromDateStr(event.date);
  const currentUsage = teamState.dayOfWeekUsage.get(dayOfWeek) || 0;
  teamState.dayOfWeekUsage.set(dayOfWeek, currentUsage + 1);

  // Update dates used - track field and cage dates separately
  // Games and practices use fields, cages use cages
  if (event.eventType === 'cage') {
    teamState.cageDatesUsed.add(event.date);
  } else {
    teamState.fieldDatesUsed.add(event.date);
  }
}

/**
 * Rejection reasons for candidate generation logging
 */
interface CandidateRejectionStats {
  durationTooShort: number;
  resourceConflict: number;
  teamAlreadyHasEvent: number;
  total: number;
}

/**
 * Generate placement candidates for a practice or cage session
 */
export function generateCandidatesForTeamEvent(
  teamState: TeamSchedulingState,
  eventType: 'practice' | 'cage',
  resourceSlots: ResourceSlot[],
  week: WeekDefinition,
  durationHours: number,
  seasonPeriodId: string,
  context: ScoringContext,
  enableLogging: boolean = false
): PlacementCandidate[] {
  const candidates: PlacementCandidate[] = [];
  const rejectionStats: CandidateRejectionStats = {
    durationTooShort: 0,
    resourceConflict: 0,
    teamAlreadyHasEvent: 0,
    total: 0,
  };
  const dateStats: Map<string, { slots: number; rejected: string[]; accepted: number }> = new Map();

  // Filter slots to this week and compatible resources
  const weekSlots = resourceSlots.filter((rs) => week.dates.includes(rs.slot.date));

  // Determine which dates set to check based on event type
  // Cage events only conflict with other cage events on the same date
  // Field events (practice) only conflict with other field events on the same date
  const relevantDatesUsed = eventType === 'cage' ? teamState.cageDatesUsed : teamState.fieldDatesUsed;

  if (enableLogging) {
    console.log(`      [generateCandidates] Team ${teamState.teamName}: ${weekSlots.length} slots in week ${week.weekNumber + 1}`);
    console.log(`      [generateCandidates] Team ${eventType} dates already used: [${Array.from(relevantDatesUsed).sort().join(', ')}]`);
    console.log(`      [generateCandidates] Team field dates: [${Array.from(teamState.fieldDatesUsed).sort().join(', ')}]`);
    console.log(`      [generateCandidates] Team cage dates: [${Array.from(teamState.cageDatesUsed).sort().join(', ')}]`);

    // Log available dates in this week
    const datesWithSlots = new Set(weekSlots.map(s => s.slot.date));
    console.log(`      [generateCandidates] Dates with slots this week: [${Array.from(datesWithSlots).sort().join(', ')}]`);
  }

  for (const slot of weekSlots) {
    // Initialize date stats
    if (!dateStats.has(slot.slot.date)) {
      dateStats.set(slot.slot.date, { slots: 0, rejected: [], accepted: 0 });
    }
    const stats = dateStats.get(slot.slot.date)!;
    stats.slots++;

    // Check if duration fits in the slot
    if (slot.slot.duration < durationHours) {
      rejectionStats.durationTooShort++;
      stats.rejected.push(`duration_short(${slot.slot.duration}h < ${durationHours}h)`);
      continue;
    }

    // Check if team already has a same-type event on this date
    // (cage + field on same day is OK, but not two field events or two cage events)
    if (relevantDatesUsed.has(slot.slot.date)) {
      rejectionStats.teamAlreadyHasEvent++;
      stats.rejected.push(`team_has_${eventType}_event`);
      continue;
    }

    // Generate candidates at 30-minute intervals within the slot
    const [startH, startM] = slot.slot.startTime.split(':').map(Number);
    const [endH, endM] = slot.slot.endTime.split(':').map(Number);
    const slotStartMinutes = startH * 60 + startM;
    const slotEndMinutes = endH * 60 + endM;
    const durationMinutes = durationHours * 60;

    for (
      let candidateStart = slotStartMinutes;
      candidateStart + durationMinutes <= slotEndMinutes;
      candidateStart += 30
    ) {
      const candidateEnd = candidateStart + durationMinutes;
      rejectionStats.total++;

      // Check for resource conflicts
      const startTime = formatTime(candidateStart);
      const endTime = formatTime(candidateEnd);

      if (hasResourceConflict(slot.resourceId, slot.slot.date, startTime, endTime, context)) {
        rejectionStats.resourceConflict++;
        continue;
      }

      stats.accepted++;
      candidates.push({
        eventType,
        date: slot.slot.date,
        dayOfWeek: slot.slot.dayOfWeek,
        startTime,
        endTime,
        resourceId: slot.resourceId,
        resourceName: slot.resourceName,
        resourceType: slot.resourceType,
        seasonPeriodId,
        teamId: teamState.teamId,
      });
    }
  }

  if (enableLogging) {
    console.log(`      [generateCandidates] Rejection stats: duration=${rejectionStats.durationTooShort}, resourceConflict=${rejectionStats.resourceConflict}, teamHasEvent=${rejectionStats.teamAlreadyHasEvent}`);
    console.log(`      [generateCandidates] Generated ${candidates.length} candidates`);

    // Log per-date breakdown
    for (const [date, stats] of Array.from(dateStats.entries()).sort()) {
      const dayOfWeek = getDayOfWeekFromDateStr(date);
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
      if (stats.rejected.length > 0 || stats.accepted === 0) {
        console.log(`        ${date} (${dayName}): ${stats.slots} slots, ${stats.accepted} candidates, rejections: ${stats.rejected.length > 0 ? [...new Set(stats.rejected)].join(', ') : 'none'}`);
      }
    }
  }

  return candidates;
}

/**
 * Generate placement candidates for a game
 */
export function generateCandidatesForGame(
  matchup: GameMatchup,
  resourceSlots: ResourceSlot[],
  week: WeekDefinition,
  durationHours: number,
  seasonPeriodId: string,
  context: ScoringContext
): PlacementCandidate[] {
  const candidates: PlacementCandidate[] = [];

  // Filter slots to this week
  const weekSlots = resourceSlots.filter((rs) => week.dates.includes(rs.slot.date));

  for (const slot of weekSlots) {
    if (slot.slot.duration < durationHours) continue;

    const [startH, startM] = slot.slot.startTime.split(':').map(Number);
    const [endH, endM] = slot.slot.endTime.split(':').map(Number);
    const slotStartMinutes = startH * 60 + startM;
    const slotEndMinutes = endH * 60 + endM;
    const durationMinutes = durationHours * 60;

    for (
      let candidateStart = slotStartMinutes;
      candidateStart + durationMinutes <= slotEndMinutes;
      candidateStart += 30
    ) {
      const candidateEnd = candidateStart + durationMinutes;
      const startTime = formatTime(candidateStart);
      const endTime = formatTime(candidateEnd);

      if (hasResourceConflict(slot.resourceId, slot.slot.date, startTime, endTime, context)) {
        continue;
      }

      // Generate both home/away assignments as separate candidates
      // The scoring system will prefer the one that balances better
      candidates.push({
        eventType: 'game',
        date: slot.slot.date,
        dayOfWeek: slot.slot.dayOfWeek,
        startTime,
        endTime,
        resourceId: slot.resourceId,
        resourceName: slot.resourceName,
        resourceType: 'field',
        seasonPeriodId,
        homeTeamId: matchup.homeTeamId,
        awayTeamId: matchup.awayTeamId,
      });

      // Also consider swapped home/away
      candidates.push({
        eventType: 'game',
        date: slot.slot.date,
        dayOfWeek: slot.slot.dayOfWeek,
        startTime,
        endTime,
        resourceId: slot.resourceId,
        resourceName: slot.resourceName,
        resourceType: 'field',
        seasonPeriodId,
        homeTeamId: matchup.awayTeamId,
        awayTeamId: matchup.homeTeamId,
      });
    }
  }

  return candidates;
}

/**
 * Check if there's a resource conflict at the given time
 */
function hasResourceConflict(
  resourceId: string,
  date: string,
  startTime: string,
  endTime: string,
  context: ScoringContext
): boolean {
  return context.scheduledEvents.some((event) => {
    if (event.date !== date) return false;
    const eventResourceId = event.fieldId || event.cageId;
    if (eventResourceId !== resourceId) return false;
    return timesOverlap(event.startTime, event.endTime, startTime, endTime);
  });
}

/**
 * Check if a team has a time conflict at the given date/time
 */
function hasTeamTimeConflict(
  teamId: string,
  date: string,
  startTime: string,
  endTime: string,
  context: ScoringContext
): boolean {
  return context.scheduledEvents.some((event) => {
    if (event.date !== date) return false;
    // Check if team is involved in this event
    const isInvolved = event.teamId === teamId ||
                       event.homeTeamId === teamId ||
                       event.awayTeamId === teamId;
    if (!isInvolved) return false;
    return timesOverlap(event.startTime, event.endTime, startTime, endTime);
  });
}

/**
 * Check if two time ranges overlap
 */
function timesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const s1 = toMinutes(start1);
  const e1 = toMinutes(end1);
  const s2 = toMinutes(start2);
  const e2 = toMinutes(end2);
  return s1 < e2 && s2 < e1;
}

/**
 * Format minutes to HH:MM
 */
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Score and sort candidates, returning the best one
 */
export function selectBestCandidate(
  candidates: PlacementCandidate[],
  teamState: TeamSchedulingState,
  context: ScoringContext,
  weights: ScoringWeights
): ScoredCandidate | null {
  if (candidates.length === 0) return null;

  const scored = candidates.map((c) =>
    calculatePlacementScore(c, teamState, context, weights)
  );

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored[0];
}

/**
 * Convert a scored candidate to a scheduled event draft
 */
export function candidateToEventDraft(
  candidate: ScoredCandidate,
  divisionId: string
): ScheduledEventDraft {
  return {
    seasonPeriodId: candidate.seasonPeriodId,
    divisionId,
    eventType: candidate.eventType,
    date: candidate.date,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    fieldId: candidate.resourceType === 'field' ? candidate.resourceId : undefined,
    cageId: candidate.resourceType === 'cage' ? candidate.resourceId : undefined,
    homeTeamId: candidate.homeTeamId,
    awayTeamId: candidate.awayTeamId,
    teamId: candidate.teamId,
  };
}

/**
 * Get the week number for a date
 */
export function getWeekNumberForDate(date: string, weeks: WeekDefinition[]): number {
  for (const week of weeks) {
    if (date >= week.startDate && date <= week.endDate) {
      return week.weekNumber;
    }
  }
  return -1;
}

/**
 * Check if a team needs more events of a given type in a week
 */
export function teamNeedsEventInWeek(
  teamState: TeamSchedulingState,
  eventType: EventType,
  weekNumber: number,
  config: { practicesPerWeek: number; gamesPerWeek: number; cageSessionsPerWeek: number }
): boolean {
  const weekEvents = teamState.eventsPerWeek.get(weekNumber) || { games: 0, practices: 0, cages: 0 };

  switch (eventType) {
    case 'game':
      return weekEvents.games < (config.gamesPerWeek || 0);
    case 'practice':
      return weekEvents.practices < config.practicesPerWeek;
    case 'cage':
      return weekEvents.cages < (config.cageSessionsPerWeek || 0);
  }
}

/**
 * Check if any team still needs events of a given type in a week
 */
export function anyTeamNeedsEventInWeek(
  teamStates: TeamSchedulingState[],
  eventType: EventType,
  weekNumber: number,
  configs: Map<string, { practicesPerWeek: number; gamesPerWeek: number; cageSessionsPerWeek: number }>
): boolean {
  return teamStates.some((ts) => {
    const config = configs.get(ts.divisionId);
    if (!config) return false;
    return teamNeedsEventInWeek(ts, eventType, weekNumber, config);
  });
}
