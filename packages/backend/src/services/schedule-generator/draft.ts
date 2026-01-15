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

// Verbose logging - set to true to enable detailed console output
const VERBOSE_LOGGING = false;
function verboseLog(...args: unknown[]): void {
  if (VERBOSE_LOGGING) {
    console.log(...args);
  }
}

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
 * Calculate the number of days between two date strings (YYYY-MM-DD)
 */
export function calculateDaysBetween(date1: string, date2: string): number {
  const d1 = parseLocalDate(date1);
  const d2 = parseLocalDate(date2);
  const diffMs = Math.abs(d2.getTime() - d1.getTime());
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
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
 * Round-robin matchup for a single round
 */
export interface RoundMatchup {
  homeTeamId: string;
  awayTeamId: string;
}

/**
 * A complete round in round-robin scheduling
 */
export interface ScheduleRound {
  roundNumber: number;
  matchups: RoundMatchup[];
}

/**
 * Generate team pairings for Sunday paired practice.
 * Uses a rotating algorithm so different teams pair each week.
 *
 * For n teams, creates n/2 pairs. The pairings rotate each week so
 * teams practice with different partners throughout the season.
 *
 * @param teamIds - Array of team IDs (must be even number)
 * @param weekNumber - Week number (0-based) to generate pairings for
 * @returns Array of [team1Id, team2Id] pairs
 */
export function generateTeamPairingsForWeek(
  teamIds: string[],
  weekNumber: number
): Array<[string, string]> {
  if (teamIds.length < 2) {
    return [];
  }

  // Ensure even number of teams
  const teams = [...teamIds];
  if (teams.length % 2 === 1) {
    // If odd, one team will be left out each week (rotating)
    // For simplicity, remove last team for now
    teams.pop();
  }

  const n = teams.length;
  if (n < 2) return [];

  // Use circle method similar to round-robin:
  // Fix first team, rotate the rest
  const fixed = teams[0];
  const rotating = teams.slice(1);

  // Rotate by weekNumber positions
  const rotated = rotateArray(rotating, weekNumber);

  // Create pairs: fixed with last rotated, then pair adjacent teams
  const pairs: Array<[string, string]> = [];

  // First pair: fixed team with the team that rotated to the "end"
  pairs.push([fixed, rotated[rotated.length - 1]]);

  // Remaining pairs: match from outside in
  for (let i = 0; i < (rotated.length - 1) / 2; i++) {
    pairs.push([rotated[i], rotated[rotated.length - 2 - i]]);
  }

  return pairs;
}

/**
 * Generate round-robin matchups for a list of teams.
 * Uses the circle method: fix one team, rotate others.
 * Tracks home/away per pairing AND per team to ensure global balance.
 *
 * For n teams:
 * - If n is even: n-1 rounds, n/2 games per round
 * - If n is odd: n rounds, (n-1)/2 games per round (one team has bye each round)
 *
 * @param teamIds - Array of team IDs in the division
 * @param gamesPerMatchup - How many times each pair should play (default 1 for single round-robin, 2 for double)
 * @returns Array of schedule rounds with matchups
 */
export function generateRoundRobinMatchups(
  teamIds: string[],
  gamesPerMatchup: number = 1
): ScheduleRound[] {
  if (teamIds.length < 2) {
    return [];
  }

  // Rotate team order to distribute the "fixed position" advantage fairly
  // The first team in the array is fixed in the round-robin rotation and gets structural advantages
  // By rotating based on team count hash, different teams get the advantage
  // This is deterministic (same teams = same rotation) but fair across seasons
  const teamsCopy = [...teamIds].sort(); // Sort first for deterministic ordering
  const rotateBy = teamsCopy.length > 0
    ? teamsCopy.reduce((hash, id) => hash + id.charCodeAt(id.length - 1), 0) % teamsCopy.length
    : 0;
  const teams = [...teamsCopy.slice(rotateBy), ...teamsCopy.slice(0, rotateBy)];

  // For odd number of teams, add a "BYE" placeholder
  const hasBye = teams.length % 2 === 1;
  if (hasBye) {
    teams.push('BYE');
  }

  const n = teams.length;
  const roundsPerCycle = n - 1;
  const gamesPerRound = n / 2;

  const allRounds: ScheduleRound[] = [];

  // Track home/away count per pairing to ensure pairing balance
  const pairingHomeCount = new Map<string, Map<string, number>>();

  // Track global home/away count per team to ensure overall balance
  const globalHomeCount = new Map<string, number>();
  const globalAwayCount = new Map<string, number>();
  for (const team of teams) {
    if (team !== 'BYE') {
      globalHomeCount.set(team, 0);
      globalAwayCount.set(team, 0);
    }
  }

  const getPairingKey = (t1: string, t2: string): string => {
    return t1 < t2 ? `${t1}-${t2}` : `${t2}-${t1}`;
  };

  const getHomeTeam = (t1: string, t2: string): string => {
    const key = getPairingKey(t1, t2);
    if (!pairingHomeCount.has(key)) {
      pairingHomeCount.set(key, new Map([[t1, 0], [t2, 0]]));
    }
    const counts = pairingHomeCount.get(key)!;
    const t1PairingHome = counts.get(t1) || 0;
    const t2PairingHome = counts.get(t2) || 0;

    // First priority: balance within this pairing
    let homeTeam: string;
    if (t1PairingHome < t2PairingHome) {
      homeTeam = t1;
    } else if (t2PairingHome < t1PairingHome) {
      homeTeam = t2;
    } else {
      // Pairing is tied - use global balance as tiebreaker
      // Give home to the team with fewer total home games
      const t1GlobalHome = globalHomeCount.get(t1) || 0;
      const t2GlobalHome = globalHomeCount.get(t2) || 0;

      if (t1GlobalHome < t2GlobalHome) {
        homeTeam = t1;
      } else if (t2GlobalHome < t1GlobalHome) {
        homeTeam = t2;
      } else {
        // Both tied - alternate based on total meetings in this pairing
        const totalMeetings = t1PairingHome + t2PairingHome;
        homeTeam = totalMeetings % 2 === 0 ? (t1 < t2 ? t1 : t2) : (t1 < t2 ? t2 : t1);
      }
    }

    const awayTeam = homeTeam === t1 ? t2 : t1;

    // Update pairing counts
    counts.set(homeTeam, (counts.get(homeTeam) || 0) + 1);

    // Update global counts
    globalHomeCount.set(homeTeam, (globalHomeCount.get(homeTeam) || 0) + 1);
    globalAwayCount.set(awayTeam, (globalAwayCount.get(awayTeam) || 0) + 1);

    return homeTeam;
  };

  // Generate rounds for each cycle (gamesPerMatchup cycles total)
  for (let cycle = 0; cycle < gamesPerMatchup; cycle++) {
    // Create a working copy of teams for rotation
    // Fix the first team, rotate the rest
    const fixed = teams[0];
    let rotating = teams.slice(1);

    for (let round = 0; round < roundsPerCycle; round++) {
      const matchups: RoundMatchup[] = [];
      const roundNumber = cycle * roundsPerCycle + round;

      // Build the current round's list
      const currentOrder = [fixed, ...rotating];

      for (let i = 0; i < gamesPerRound; i++) {
        const team1 = currentOrder[i];
        const team2 = currentOrder[n - 1 - i];

        // Skip BYE matchups
        if (team1 === 'BYE' || team2 === 'BYE') {
          continue;
        }

        // Determine home team based on pairing and global history
        const homeTeam = getHomeTeam(team1, team2);
        const awayTeam = homeTeam === team1 ? team2 : team1;

        matchups.push({
          homeTeamId: homeTeam,
          awayTeamId: awayTeam,
        });
      }

      allRounds.push({
        roundNumber,
        matchups,
      });

      // Rotate: move last element to position 1
      rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
    }
  }

  return allRounds;
}

/**
 * Flatten round-robin rounds into a simple list of GameMatchups with week targets.
 * This assigns each round to a week, spreading matchups evenly across the season.
 *
 * @param rounds - The generated round-robin rounds
 * @param divisionId - Division ID for the matchups
 * @param totalWeeks - Total number of weeks in the game season
 * @param gamesPerTeamPerWeek - Target games per team per week
 * @returns Array of matchups with target week assignments
 */
export function assignMatchupsToWeeks(
  rounds: ScheduleRound[],
  divisionId: string,
  totalWeeks: number,
  gamesPerTeamPerWeek: number
): Array<GameMatchup & { targetWeek: number }> {
  const result: Array<GameMatchup & { targetWeek: number }> = [];

  if (rounds.length === 0 || totalWeeks === 0) {
    return result;
  }

  // Calculate how to distribute rounds across weeks
  // Each round represents one game per team (approximately)
  // With gamesPerTeamPerWeek, we should pack that many rounds per week

  let currentWeek = 0;
  let gamesThisWeek = 0;

  // Estimate games per team per round (for divisions with even teams, it's 1)
  const teamsPerRound = rounds[0]?.matchups.length * 2 || 2;
  const gamesPerTeamPerRound = 1; // In round-robin, each team plays once per round

  for (const round of rounds) {
    for (const matchup of round.matchups) {
      result.push({
        homeTeamId: matchup.homeTeamId,
        awayTeamId: matchup.awayTeamId,
        divisionId,
        targetWeek: currentWeek,
      });
    }

    gamesThisWeek += gamesPerTeamPerRound;

    // Move to next week if we've filled this one
    if (gamesThisWeek >= gamesPerTeamPerWeek && currentWeek < totalWeeks - 1) {
      currentWeek++;
      gamesThisWeek = 0;
    }
  }

  return result;
}

/**
 * Initialize team scheduling state
 */
export function initializeTeamState(
  teamId: string,
  teamName: string,
  divisionId: string,
  divisionName: string,
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
    divisionName,
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
    matchupHomeAway: new Map(),
    fieldDatesUsed: new Set(),
    cageDatesUsed: new Set(),
    minDaysBetweenEvents: requirements.minDaysBetweenEvents,
    gameDates: [],
    shortRestGamesCount: 0,
  };
}

/**
 * Update team state after scheduling an event
 * For games, isHomeTeam indicates if this team is home, and opponentId is the other team
 * isSpillover indicates if this is a spillover game (from a previous week) - these don't count against weekly quota
 */
export function updateTeamStateAfterScheduling(
  teamState: TeamSchedulingState,
  event: ScheduledEventDraft,
  weekNumber: number,
  isHomeTeam?: boolean,
  opponentId?: string,
  isSpillover?: boolean
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

        // Update per-opponent home/away tracking
        if (opponentId) {
          const matchup = teamState.matchupHomeAway.get(opponentId) || { home: 0, away: 0 };
          if (isHomeTeam) {
            matchup.home++;
          } else {
            matchup.away++;
          }
          teamState.matchupHomeAway.set(opponentId, matchup);
        }
      }

      // Track game dates and short rest count
      // Check if this game is within 2 days of ANY existing game (games can be scheduled out of order)
      const newGameDate = event.date;
      const isShortRest = teamState.gameDates.some(
        (existingDate) => calculateDaysBetween(existingDate, newGameDate) <= 2
      );
      if (isShortRest) {
        teamState.shortRestGamesCount++;
      }
      // Insert date in sorted order
      teamState.gameDates.push(newGameDate);
      teamState.gameDates.sort();
      break;
    case 'practice':
      teamState.practicesScheduled++;
      break;
    case 'cage':
      teamState.cagesScheduled++;
      break;
    case 'paired_practice':
      // Paired practice counts as both a practice AND a cage session
      teamState.practicesScheduled++;
      teamState.cagesScheduled++;
      break;
  }

  // Update week tracking
  if (!teamState.eventsPerWeek.has(weekNumber)) {
    teamState.eventsPerWeek.set(weekNumber, { games: 0, practices: 0, cages: 0, spilloverGames: 0 });
  }
  const weekEvents = teamState.eventsPerWeek.get(weekNumber)!;
  switch (event.eventType) {
    case 'game':
      weekEvents.games++;
      // Track spillover games separately - they don't count against weekly quota
      if (isSpillover) {
        weekEvents.spilloverGames++;
      }
      break;
    case 'practice':
      weekEvents.practices++;
      break;
    case 'cage':
      weekEvents.cages++;
      break;
    case 'paired_practice':
      // Paired practice counts toward both practices and cages quotas
      weekEvents.practices++;
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
  } else if (event.eventType === 'paired_practice') {
    // Paired practice uses both field and cage
    teamState.fieldDatesUsed.add(event.date);
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
  seasonId: string,
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
    verboseLog(`      [generateCandidates] Team ${teamState.teamName}: ${weekSlots.length} slots in week ${week.weekNumber + 1}`);
    verboseLog(`      [generateCandidates] Team ${eventType} dates already used: [${Array.from(relevantDatesUsed).sort().join(', ')}]`);
    verboseLog(`      [generateCandidates] Team field dates: [${Array.from(teamState.fieldDatesUsed).sort().join(', ')}]`);
    verboseLog(`      [generateCandidates] Team cage dates: [${Array.from(teamState.cageDatesUsed).sort().join(', ')}]`);

    // Log available dates in this week
    const datesWithSlots = new Set(weekSlots.map(s => s.slot.date));
    verboseLog(`      [generateCandidates] Dates with slots this week: [${Array.from(datesWithSlots).sort().join(', ')}]`);
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

    // Check if team has a GAME on this date - games block all other events
    // (practices and cage sessions should not be scheduled on game days)
    if (teamState.gameDates.includes(slot.slot.date)) {
      rejectionStats.teamAlreadyHasEvent++;
      stats.rejected.push('team_has_game');
      continue;
    }

    // Skip single-event-only slots that already have an event
    if (slot.singleEventOnly) {
      const key = `${slot.slot.date}-${slot.resourceId}`;
      const existingEvents = context.eventsByDateResource?.get(key);
      if (existingEvents && existingEvents.length > 0) {
        stats.rejected.push('single_event_only_slot_taken');
        continue;
      }
    }

    // Generate candidates at 30-minute intervals within the slot
    const [startH, startM] = slot.slot.startTime.split(':').map(Number);
    const [endH, endM] = slot.slot.endTime.split(':').map(Number);
    const slotStartMinutes = startH * 60 + startM;
    const slotEndMinutes = endH * 60 + endM;
    const durationMinutes = durationHours * 60;

    // Use 60-minute intervals for practices/cages to reduce candidate count
    // (30-min intervals generated too many candidates, slowing down scoring)
    const interval = 60;
    for (
      let candidateStart = slotStartMinutes;
      candidateStart + durationMinutes <= slotEndMinutes;
      candidateStart += interval
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
        seasonId,
        teamId: teamState.teamId,
      });
    }
  }

  if (enableLogging) {
    verboseLog(`      [generateCandidates] Rejection stats: duration=${rejectionStats.durationTooShort}, resourceConflict=${rejectionStats.resourceConflict}, teamHasEvent=${rejectionStats.teamAlreadyHasEvent}`);
    verboseLog(`      [generateCandidates] Generated ${candidates.length} candidates`);

    // Log per-date breakdown
    for (const [date, stats] of Array.from(dateStats.entries()).sort()) {
      const dayOfWeek = getDayOfWeekFromDateStr(date);
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
      if (stats.rejected.length > 0 || stats.accepted === 0) {
        verboseLog(`        ${date} (${dayName}): ${stats.slots} slots, ${stats.accepted} candidates, rejections: ${stats.rejected.length > 0 ? [...new Set(stats.rejected)].join(', ') : 'none'}`);
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
  seasonId: string,
  context: ScoringContext
): PlacementCandidate[] {
  const candidates: PlacementCandidate[] = [];

  // Filter slots to this week
  const weekSlots = resourceSlots.filter((rs) => week.dates.includes(rs.slot.date));

  // Get 'avoid' days for this division - these are hard blockers
  const gameDayPrefs = context.gameDayPreferences.get(matchup.divisionId) || [];
  const avoidDays = new Set(
    gameDayPrefs.filter(p => p.priority === 'avoid').map(p => p.dayOfWeek)
  );

  // Get team states for checking existing events
  const homeTeamState = context.teamStates.get(matchup.homeTeamId);
  const awayTeamState = context.teamStates.get(matchup.awayTeamId);

  for (const slot of weekSlots) {
    if (slot.slot.duration < durationHours) continue;

    // Skip days marked as 'avoid' - this is a hard blocker, not just a negative weight
    if (avoidDays.has(slot.slot.dayOfWeek)) continue;

    // Skip dates where either team already has any event (practice, cage, or paired practice)
    // Games should not be scheduled on days when a team has other activities
    const homeHasEvent = homeTeamState && (
      homeTeamState.fieldDatesUsed.has(slot.slot.date) ||
      homeTeamState.cageDatesUsed.has(slot.slot.date)
    );
    const awayHasEvent = awayTeamState && (
      awayTeamState.fieldDatesUsed.has(slot.slot.date) ||
      awayTeamState.cageDatesUsed.has(slot.slot.date)
    );
    if (homeHasEvent || awayHasEvent) continue;

    // Skip single-event-only slots that already have an event
    if (slot.singleEventOnly) {
      const key = `${slot.slot.date}-${slot.resourceId}`;
      const existingEvents = context.eventsByDateResource?.get(key);
      if (existingEvents && existingEvents.length > 0) {
        continue;
      }
    }

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

      // Use the home/away assignment from the matchup (determined by round-robin)
      candidates.push({
        eventType: 'game',
        date: slot.slot.date,
        dayOfWeek: slot.slot.dayOfWeek,
        startTime,
        endTime,
        resourceId: slot.resourceId,
        resourceName: slot.resourceName,
        resourceType: 'field',
        seasonId,
        homeTeamId: matchup.homeTeamId,
        awayTeamId: matchup.awayTeamId,
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
  // Use index if available for O(1) lookup instead of O(n) scan
  if (context.eventsByDateResource) {
    const key = `${date}-${resourceId}`;
    const events = context.eventsByDateResource.get(key);
    if (!events || events.length === 0) return false;
    return events.some((event) =>
      timesOverlap(event.startTime, event.endTime, startTime, endTime)
    );
  }

  // Fallback to full scan if index not available
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
 * Score candidates and return the best one (highest score)
 * Uses linear scan to find max instead of sorting all candidates
 */
export function selectBestCandidate(
  candidates: PlacementCandidate[],
  teamState: TeamSchedulingState,
  context: ScoringContext,
  weights: ScoringWeights
): ScoredCandidate | null {
  if (candidates.length === 0) return null;

  // Track best as we go - O(n) instead of O(n log n) sort
  let best: ScoredCandidate | null = null;

  for (const candidate of candidates) {
    const scored = calculatePlacementScore(candidate, teamState, context, weights);
    if (best === null || scored.score > best.score) {
      best = scored;
    }
  }

  return best;
}

/**
 * Select best candidate using two-phase approach for practices:
 * 1. Select DATE based on day-selection factors (excluding time-of-day factors)
 * 2. Select best time slot on that date using full scoring
 *
 * This ensures that factors like earliestTime and timeAdjacency only affect
 * which time slot is chosen AFTER the date has been selected, preventing
 * Saturday morning slots from being chosen over well-spaced weekday slots
 * just because they have earlier start times.
 */
export function selectBestCandidateTwoPhase(
  candidates: PlacementCandidate[],
  teamState: TeamSchedulingState,
  context: ScoringContext,
  weights: ScoringWeights
): ScoredCandidate | null {
  if (candidates.length === 0) return null;

  // Score all candidates with full scoring
  const scoredCandidates: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    scoredCandidates.push(calculatePlacementScore(candidate, teamState, context, weights));
  }

  // Group by DATE (not field) - day selection should happen first
  const byDate = new Map<string, ScoredCandidate[]>();
  for (const scored of scoredCandidates) {
    const date = scored.date;
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date)!.push(scored);
  }

  // For each date, find the best candidate and its "date selection score"
  // (score minus time-of-day factors: earliestTime and timeAdjacency)
  let bestDate: string | null = null;
  let bestDateScore = -Infinity;
  const bestByDate = new Map<string, ScoredCandidate>();

  for (const [date, dateCandidates] of byDate) {
    // Find best candidate on this date (using full score)
    let bestOnDate: ScoredCandidate | null = null;
    for (const c of dateCandidates) {
      if (!bestOnDate || c.score > bestOnDate.score) {
        bestOnDate = c;
      }
    }

    if (bestOnDate) {
      bestByDate.set(date, bestOnDate);

      // Calculate date selection score (exclude time-of-day factors)
      // earliestTime and timeAdjacency should not affect which DAY is selected
      const dateSelectionScore =
        bestOnDate.score -
        (bestOnDate.scoreBreakdown?.earliestTime || 0) -
        (bestOnDate.scoreBreakdown?.timeAdjacency || 0);

      if (dateSelectionScore > bestDateScore) {
        bestDateScore = dateSelectionScore;
        bestDate = date;
      }
    }
  }

  // Return the best candidate from the selected date
  return bestDate ? bestByDate.get(bestDate) || null : null;
}

/**
 * Convert a scored candidate to a scheduled event draft
 */
export function candidateToEventDraft(
  candidate: ScoredCandidate,
  divisionId: string
): ScheduledEventDraft {
  return {
    seasonId: candidate.seasonId,
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
  const weekEvents = teamState.eventsPerWeek.get(weekNumber) || { games: 0, practices: 0, cages: 0, spilloverGames: 0 };

  switch (eventType) {
    case 'game':
      return weekEvents.games < (config.gamesPerWeek || 0);
    case 'practice':
      return weekEvents.practices < config.practicesPerWeek;
    case 'cage':
      return weekEvents.cages < (config.cageSessionsPerWeek || 0);
    case 'paired_practice':
      // Paired practice is scheduled separately, not checked via this function
      return false;
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
