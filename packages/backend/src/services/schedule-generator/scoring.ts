import type {
  PlacementCandidate,
  ScoredCandidate,
  ScoringWeights,
  TeamSchedulingState,
  ScheduledEventDraft,
  DEFAULT_SCORING_WEIGHTS,
} from '@ll-scheduler/shared';
import type { GameDayPreference } from '@ll-scheduler/shared';
import { parseLocalDate } from './draft.js';

export { DEFAULT_SCORING_WEIGHTS };

/**
 * Context information needed for scoring
 */
export interface ScoringContext {
  // All team states for looking up other teams
  teamStates: Map<string, TeamSchedulingState>;
  // Resource usage: resourceId -> date -> hours booked
  resourceUsage: Map<string, Map<string, number>>;
  // Resource capacity: resourceId -> hours per day
  resourceCapacity: Map<string, number>;
  // Division game day preferences: divisionId -> preferences
  gameDayPreferences: Map<string, GameDayPreference[]>;
  // Division field preferences: divisionId -> ordered list of field IDs (first = most preferred)
  fieldPreferences: Map<string, string[]>;
  // Week definitions for week number lookup
  weekDefinitions: Array<{ weekNumber: number; startDate: string; endDate: string }>;
  // Scheduled events for conflict checking
  scheduledEvents: ScheduledEventDraft[];
  // Division configs for weekly requirements
  divisionConfigs: Map<string, { practicesPerWeek: number; gamesPerWeek: number; cageSessionsPerWeek: number }>;
  // Team slot availability for scarcity calculation: teamId -> set of available slot keys
  teamSlotAvailability?: Map<string, Set<string>>;
  // Index for fast conflict checking: "date-resourceId" -> events at that resource on that date
  eventsByDateResource?: Map<string, ScheduledEventDraft[]>;
  // Index for fast team conflict checking: "date-teamId" -> events involving that team on that date
  eventsByDateTeam?: Map<string, ScheduledEventDraft[]>;
}

/**
 * Score breakdown for debugging and analysis
 */
export interface ScoreBreakdown {
  daySpread: number;
  weekBalance: number;
  resourceUtilization: number;
  gameDayPreference: number;
  timeQuality: number;
  homeAwayBalance: number;
  matchupHomeAwayBalance: number;
  dayGap: number;
  timeAdjacency: number;
  earliestTime: number;
  fieldPreference: number;
  sameDayEvent: number;
  scarcity: number;
  sameDayCageFieldGap: number;
  weekendMorningPractice: number;
  shortRestBalance: number;
}

/**
 * Calculate the score for a placement candidate
 * Higher scores are better placements
 *
 * All factors use the pattern: contribution = rawScore × weight
 * - rawScore is 0-1 (continuous) or 0/1 (binary)
 * - Positive weights reward higher rawScores
 * - Negative weights penalize higher rawScores
 */
export function calculatePlacementScore(
  candidate: PlacementCandidate,
  teamState: TeamSchedulingState,
  context: ScoringContext,
  weights: ScoringWeights
): ScoredCandidate {
  const breakdown: ScoreBreakdown = {
    daySpread: 0,
    weekBalance: 0,
    resourceUtilization: 0,
    gameDayPreference: 0,
    timeQuality: 0,
    homeAwayBalance: 0,
    matchupHomeAwayBalance: 0,
    dayGap: 0,
    timeAdjacency: 0,
    earliestTime: 0,
    fieldPreference: 0,
    sameDayEvent: 0,
    scarcity: 0,
    sameDayCageFieldGap: 0,
    weekendMorningPractice: 0,
    shortRestBalance: 0,
  };

  // Continuous positive factors (rawScore 0-1)
  breakdown.daySpread = calculateDaySpreadRaw(candidate.dayOfWeek, teamState) * weights.daySpread;
  breakdown.weekBalance = calculateWeekBalanceRaw(candidate.eventType, candidate.date, teamState, context) * weights.weekBalance;
  breakdown.resourceUtilization = calculateResourceUtilizationRaw(candidate.resourceId, candidate.date, context) * weights.resourceUtilization;
  breakdown.timeQuality = calculateTimeQualityRaw(candidate.startTime) * weights.timeQuality;
  breakdown.dayGap = calculateDayGapRaw(candidate.date, teamState) * weights.dayGap;
  breakdown.timeAdjacency = calculateTimeAdjacencyRaw(candidate, context) * weights.timeAdjacency;

  // Game-specific factors
  if (candidate.eventType === 'game') {
    breakdown.gameDayPreference = calculateGameDayPreferenceRaw(candidate.dayOfWeek, teamState.divisionId, context) * weights.gameDayPreference;
    breakdown.earliestTime = calculateEarliestTimeRaw(candidate, context) * weights.earliestTime;

    if (candidate.homeTeamId && candidate.awayTeamId) {
      breakdown.homeAwayBalance = calculateHomeAwayBalanceRaw(candidate.homeTeamId, candidate.awayTeamId, context) * weights.homeAwayBalance;
      breakdown.matchupHomeAwayBalance = calculateMatchupHomeAwayBalanceRaw(candidate.homeTeamId, candidate.awayTeamId, context) * weights.matchupHomeAwayBalance;
      breakdown.shortRestBalance = calculateShortRestBalanceRaw(candidate, context) * weights.shortRestBalance;
    }
  }

  // Field preference for games and practices (not cage events)
  if (candidate.resourceType === 'field') {
    breakdown.fieldPreference = calculateFieldPreferenceRaw(candidate.resourceId, teamState.divisionId, context) * weights.fieldPreference;
  }

  // Practice-specific factors
  if (candidate.eventType === 'practice') {
    breakdown.weekendMorningPractice = calculateWeekendMorningPracticeRaw(candidate.dayOfWeek, candidate.startTime) * weights.weekendMorningPractice;
    // Apply earliestTime for practices - prefer earlier times over preferred fields
    breakdown.earliestTime = calculateEarliestTimeRaw(candidate, context) * weights.earliestTime;
    // Reduce field preference weight for practices (field choice less important than for games)
    breakdown.fieldPreference = breakdown.fieldPreference * 0.3;
  }

  // Binary penalty: same-day event (only for same resource type)
  // Cage + field on same day is OK, but not two field events or two cage events
  // For games, check both home and away teams from the candidate (not teamState, which may differ)
  if (candidate.eventType === 'game' && candidate.homeTeamId && candidate.awayTeamId) {
    const homeTeam = context.teamStates.get(candidate.homeTeamId);
    const awayTeam = context.teamStates.get(candidate.awayTeamId);
    if (homeTeam?.fieldDatesUsed.has(candidate.date)) {
      breakdown.sameDayEvent += 1 * weights.sameDayEvent;
    }
    if (awayTeam?.fieldDatesUsed.has(candidate.date)) {
      breakdown.sameDayEvent += 1 * weights.sameDayEvent;
    }
  } else {
    // For practices/cages, use the passed teamState
    const relevantDatesUsed = candidate.resourceType === 'cage' ? teamState.cageDatesUsed : teamState.fieldDatesUsed;
    const sameDayRaw = relevantDatesUsed.has(candidate.date) ? 1 : 0;
    breakdown.sameDayEvent = sameDayRaw * weights.sameDayEvent;
  }

  // Continuous penalty: scarcity
  breakdown.scarcity = calculateScarcityRaw(candidate, teamState, context) * weights.scarcity;

  // Continuous penalty: same-day cage+field gap (must be adjacent if on same day)
  breakdown.sameDayCageFieldGap = calculateSameDayCageFieldGapRaw(candidate, teamState, context) * weights.sameDayCageFieldGap;

  // Calculate total score
  const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return {
    ...candidate,
    score,
    scoreBreakdown: breakdown,
  };
}

// ============================================
// Raw Score Calculations (all return 0-1)
// ============================================

/**
 * Calculate day spread raw score
 * Returns 0-1 where 1 = unused day of week, 0 = most-used day
 */
export function calculateDaySpreadRaw(
  dayOfWeek: number,
  teamState: TeamSchedulingState
): number {
  const usage = teamState.dayOfWeekUsage.get(dayOfWeek) || 0;

  // Find max usage across all days
  let maxUsage = 0;
  for (const count of teamState.dayOfWeekUsage.values()) {
    maxUsage = Math.max(maxUsage, count);
  }

  // If no events scheduled yet, all days are equally good
  if (maxUsage === 0) {
    return 1.0;
  }

  // Score inversely proportional to usage
  return 1 - usage / (maxUsage + 1);
}

/**
 * Calculate week balance raw score
 * Returns 0-1 where 1 = under quota, 0.5 = at quota, 0.2 = over quota
 */
export function calculateWeekBalanceRaw(
  eventType: 'game' | 'practice' | 'cage' | 'paired_practice',
  date: string,
  teamState: TeamSchedulingState,
  context: ScoringContext
): number {
  const weekNum = getWeekNumber(date, context.weekDefinitions);
  if (weekNum === -1) return 0.5; // Unknown week, neutral score

  const weekEvents = teamState.eventsPerWeek.get(weekNum) || { games: 0, practices: 0, cages: 0 };
  const config = context.divisionConfigs.get(teamState.divisionId);
  if (!config) return 0.5;

  let current: number;
  let required: number;

  switch (eventType) {
    case 'game':
      current = weekEvents.games;
      required = config.gamesPerWeek || 0;
      break;
    case 'practice':
    case 'paired_practice': // Paired practice counts toward practice quota
      current = weekEvents.practices;
      required = config.practicesPerWeek || 0;
      break;
    case 'cage':
      current = weekEvents.cages;
      required = config.cageSessionsPerWeek || 0;
      break;
  }

  if (current < required) {
    return 1.0;
  } else if (current === required) {
    return 0.5;
  } else {
    return 0.2;
  }
}

/**
 * Calculate resource utilization raw score
 * Returns 0-1 where 1 = empty resource, 0 = fully loaded
 */
export function calculateResourceUtilizationRaw(
  resourceId: string,
  date: string,
  context: ScoringContext
): number {
  const dateUsage = context.resourceUsage.get(resourceId)?.get(date) || 0;
  const capacity = context.resourceCapacity.get(resourceId) || 8; // Default 8 hours

  const loadPercent = dateUsage / capacity;
  return Math.max(0, 1 - loadPercent);
}

/**
 * Calculate game day preference raw score
 * Returns 0-1 where 1 = required day, 0.1 = avoid day
 */
export function calculateGameDayPreferenceRaw(
  dayOfWeek: number,
  divisionId: string,
  context: ScoringContext
): number {
  const preferences = context.gameDayPreferences.get(divisionId) || [];

  const pref = preferences.find((p) => p.dayOfWeek === dayOfWeek);
  if (!pref) {
    return 0.5; // No preference set, neutral
  }

  switch (pref.priority) {
    case 'required':
      return 1.0;
    case 'preferred':
      return 0.8;
    case 'acceptable':
      return 0.5;
    case 'avoid':
      return 0.1;
    default:
      return 0.5;
  }
}

/**
 * Calculate field preference raw score
 * Returns 0-1 where 1 = most preferred field, decreasing for lower preferences, 0.5 = not in list
 */
export function calculateFieldPreferenceRaw(
  fieldId: string,
  divisionId: string,
  context: ScoringContext
): number {
  const preferences = context.fieldPreferences.get(divisionId) || [];

  if (preferences.length === 0) {
    return 0.5; // No preferences configured, neutral
  }

  const index = preferences.indexOf(fieldId);
  if (index === -1) {
    return 0.3; // Field not in preferences list - less preferred than any listed field
  }

  // Score from 1.0 (first preference) down to 0.5 (last preference)
  // This ensures any preferred field scores higher than non-preferred
  return 1.0 - (index / preferences.length) * 0.5;
}

/**
 * Calculate time quality raw score
 * Returns 0-1 where 1 = ideal time (3-6pm), ~0.4 = far from ideal
 */
export function calculateTimeQualityRaw(startTime: string): number {
  const [hours, minutes] = startTime.split(':').map(Number);
  const timeInMinutes = hours * 60 + minutes;

  // Ideal range: 3pm-6pm
  const idealStart = 15 * 60; // 3pm
  const idealEnd = 18 * 60; // 6pm

  if (timeInMinutes >= idealStart && timeInMinutes <= idealEnd) {
    return 1.0;
  }

  // Calculate distance from ideal range
  let distance: number;
  if (timeInMinutes < idealStart) {
    distance = idealStart - timeInMinutes;
  } else {
    distance = timeInMinutes - idealEnd;
  }

  // Score decreases with distance (max penalty at 4+ hours away)
  const maxDistance = 4 * 60; // 4 hours
  const penalty = Math.min(distance / maxDistance, 1);
  return 1 - penalty * 0.6; // Max 60% penalty, so minimum is 0.4
}

/**
 * Calculate earliest time raw score (for games)
 *
 * Simply prefers earlier start times - earlier is always better.
 * Score decreases linearly based on start time.
 */
export function calculateEarliestTimeRaw(
  candidate: PlacementCandidate,
  _context: ScoringContext
): number {
  const candidateStartMinutes = timeToMinutes(candidate.startTime);

  // Score from 1.0 (midnight) down to 0.0 (midnight next day)
  // Earlier times always score higher
  const maxMinutes = 24 * 60;
  return 1.0 - candidateStartMinutes / maxMinutes;
}

/**
 * Calculate weekend morning practice penalty raw score
 * Returns 0-1 where:
 * - 1 = practice on weekend morning (before 1pm on Sat/Sun) - apply penalty
 * - 0 = practice on weekday or weekend afternoon - no penalty
 *
 * This reserves weekend mornings for games
 */
export function calculateWeekendMorningPracticeRaw(dayOfWeek: number, startTime: string): number {
  // Check if it's a weekend (0 = Sunday, 6 = Saturday)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (!isWeekend) {
    return 0; // No penalty for weekday practices
  }

  // Check if it's a morning slot (before 1pm)
  const [hours] = startTime.split(':').map(Number);
  const isMorning = hours < 13; // Before 1pm

  if (isMorning) {
    return 1; // Full penalty for weekend morning practices
  }

  return 0; // No penalty for weekend afternoon practices
}

/**
 * Calculate home/away balance raw score
 * Returns 0-1 where 1 = balanced, 0 = very imbalanced
 */
export function calculateHomeAwayBalanceRaw(
  homeTeamId: string,
  awayTeamId: string,
  context: ScoringContext
): number {
  const homeTeam = context.teamStates.get(homeTeamId);
  const awayTeam = context.teamStates.get(awayTeamId);

  if (!homeTeam || !awayTeam) return 0.5;

  // Calculate current imbalance
  const homeImbalance = homeTeam.homeGames - homeTeam.awayGames;
  const awayImbalance = awayTeam.homeGames - awayTeam.awayGames;

  // This assignment would add 1 home game to homeTeam and 1 away game to awayTeam
  const newHomeImbalance = homeImbalance + 1;
  const newAwayImbalance = awayImbalance - 1;

  // Score based on total absolute imbalance (lower is better)
  const totalImbalance = Math.abs(newHomeImbalance) + Math.abs(newAwayImbalance);

  // Max imbalance we expect is around 6-8 for a 10-game season
  // Scale so 0 imbalance = 1.0, 8 imbalance = 0
  return Math.max(0, 1 - totalImbalance / 8);
}

/**
 * Calculate matchup-specific home/away balance raw score
 * Returns 0-1 where 1 = this assignment improves/maintains balance, 0 = creates imbalance
 *
 * For example, if Team A has played Team B 3 times (2 home, 1 away),
 * scheduling Team A as home again would increase imbalance (score closer to 0),
 * while scheduling Team A as away would improve balance (score closer to 1).
 */
export function calculateMatchupHomeAwayBalanceRaw(
  homeTeamId: string,
  awayTeamId: string,
  context: ScoringContext
): number {
  const homeTeam = context.teamStates.get(homeTeamId);
  const awayTeam = context.teamStates.get(awayTeamId);

  if (!homeTeam || !awayTeam) return 0.5;

  // Get current matchup history from home team's perspective
  const homeTeamMatchup = homeTeam.matchupHomeAway.get(awayTeamId) || { home: 0, away: 0 };

  // Current imbalance (positive = more home games, negative = more away games)
  const currentImbalance = homeTeamMatchup.home - homeTeamMatchup.away;

  // This assignment would add 1 home game for homeTeam against awayTeam
  const newImbalance = currentImbalance + 1;

  // Score based on absolute imbalance after this assignment
  // 0 imbalance = 1.0 (perfect)
  // 1 imbalance = 0.75
  // 2 imbalance = 0.5
  // 3 imbalance = 0.25
  // 4+ imbalance = 0
  return Math.max(0, 1 - Math.abs(newImbalance) / 4);
}

/**
 * Calculate short rest balance raw score for games
 * Returns 0-1 where:
 * - 0 = no penalty (this game won't create short rest, or team is below/at average short rest count)
 * - 1 = full penalty (this game creates short rest and team already has more than division average)
 *
 * This encourages distributing short-rest games evenly across teams in a division.
 * A "short rest" game is one scheduled ≤2 days after the team's previous game.
 */
export function calculateShortRestBalanceRaw(
  candidate: PlacementCandidate,
  context: ScoringContext
): number {
  if (!candidate.homeTeamId || !candidate.awayTeamId) {
    return 0;
  }

  const homeTeam = context.teamStates.get(candidate.homeTeamId);
  const awayTeam = context.teamStates.get(candidate.awayTeamId);

  if (!homeTeam || !awayTeam) {
    return 0;
  }

  // Check if either team would have a short rest game (≤2 days from ANY existing game)
  // Games can be scheduled out of chronological order, so we need to check all dates
  const candidateDayNum = dateToDayNumber(candidate.date);

  const wouldBeShortRestForHome = homeTeam.gameDates.some(
    (date) => Math.abs(candidateDayNum - dateToDayNumber(date)) <= 2
  );

  const wouldBeShortRestForAway = awayTeam.gameDates.some(
    (date) => Math.abs(candidateDayNum - dateToDayNumber(date)) <= 2
  );

  // If neither team would have short rest, no penalty
  if (!wouldBeShortRestForHome && !wouldBeShortRestForAway) {
    return 0;
  }

  // Calculate division average short rest count
  // Only look at teams in the same division(s)
  const divisionsToCheck = new Set([homeTeam.divisionId, awayTeam.divisionId]);
  let totalShortRestCount = 0;
  let teamCount = 0;

  for (const [, teamState] of context.teamStates) {
    if (divisionsToCheck.has(teamState.divisionId)) {
      totalShortRestCount += teamState.shortRestGamesCount;
      teamCount++;
    }
  }

  const avgShortRest = teamCount > 0 ? totalShortRestCount / teamCount : 0;

  // Calculate penalty for each team that would get short rest
  let maxPenalty = 0;

  if (wouldBeShortRestForHome) {
    // How much above average is this team?
    const excess = homeTeam.shortRestGamesCount - avgShortRest;
    // Penalty increases when team is above average
    // 0 excess = 0.3 penalty (still some penalty for any short rest)
    // 1 excess = 0.6 penalty
    // 2+ excess = 1.0 penalty
    const penalty = Math.min(1, 0.3 + Math.max(0, excess) * 0.35);
    maxPenalty = Math.max(maxPenalty, penalty);
  }

  if (wouldBeShortRestForAway) {
    const excess = awayTeam.shortRestGamesCount - avgShortRest;
    const penalty = Math.min(1, 0.3 + Math.max(0, excess) * 0.35);
    maxPenalty = Math.max(maxPenalty, penalty);
  }

  return maxPenalty;
}

/**
 * Convert YYYY-MM-DD to day number (days since epoch, approximately)
 * This avoids expensive Date object creation
 */
function dateToDayNumber(dateStr: string): number {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(5, 7), 10);
  const day = parseInt(dateStr.substring(8, 10), 10);
  // Approximate days since epoch - doesn't need to be exact, just consistent
  return year * 365 + month * 30 + day;
}

/**
 * Calculate day gap raw score
 * Returns 0-1 where:
 * - 1.0 = 2+ day gap between events (ideal)
 * - 0.5 = consecutive day (1 day gap)
 * - 0.0 = same day (but blocked by sameDayEvent anyway)
 *
 * Note: This considers ALL events (both field and cage) when calculating gaps,
 * since we want to spread out a team's overall schedule even if cage + field
 * on same day is technically allowed.
 */
export function calculateDayGapRaw(
  candidateDate: string,
  teamState: TeamSchedulingState
): number {
  // Quick check: if both sets are empty, return early
  if (teamState.fieldDatesUsed.size === 0 && teamState.cageDatesUsed.size === 0) {
    return 1.0; // No existing events, best possible score
  }

  // Convert candidate date to day number (fast integer math instead of Date objects)
  const candidateDayNum = dateToDayNumber(candidateDate);
  let closestGap = Infinity;

  // Check field dates without creating new Set
  for (const usedDate of teamState.fieldDatesUsed) {
    const gapDays = Math.abs(candidateDayNum - dateToDayNumber(usedDate));
    closestGap = Math.min(closestGap, gapDays);
    if (closestGap === 0) return 0; // Early exit - can't get closer
  }

  // Check cage dates
  for (const usedDate of teamState.cageDatesUsed) {
    const gapDays = Math.abs(candidateDayNum - dateToDayNumber(usedDate));
    closestGap = Math.min(closestGap, gapDays);
    if (closestGap === 0) return 0; // Early exit - can't get closer
  }

  // Scale: 0 days → 0, 1 day → 0.5, 2+ days → 1.0
  return Math.min(closestGap / 2, 1.0);
}

/**
 * Calculate time adjacency raw score
 * Returns 0-1 where:
 * - 1.0 = directly adjacent to an existing event (no gap)
 * - 0.5 = small gap (1-2 hours)
 * - 0.0 = no events on this resource/date or large gap
 *
 * Encourages packing events together on the same resource
 */
export function calculateTimeAdjacencyRaw(
  candidate: PlacementCandidate,
  context: ScoringContext
): number {
  // Find events on the same resource and date - use index if available
  let sameResourceDateEvents: ScheduledEventDraft[];
  if (context.eventsByDateResource) {
    const key = `${candidate.date}-${candidate.resourceId}`;
    sameResourceDateEvents = context.eventsByDateResource.get(key) || [];
  } else {
    sameResourceDateEvents = context.scheduledEvents.filter(
      (e) =>
        e.date === candidate.date &&
        ((e.fieldId && e.fieldId === candidate.resourceId) ||
          (e.cageId && e.cageId === candidate.resourceId))
    );
  }

  if (sameResourceDateEvents.length === 0) {
    // No existing events - neutral score (first event of the day)
    // We want to encourage starting early, so return a small bonus for early times
    return 0.3;
  }

  const candidateStart = timeToMinutes(candidate.startTime);
  const candidateEnd = timeToMinutes(candidate.endTime);

  let minGap = Infinity;

  for (const event of sameResourceDateEvents) {
    const eventStart = timeToMinutes(event.startTime);
    const eventEnd = timeToMinutes(event.endTime);

    // Calculate gap between candidate and existing event
    let gap: number;
    if (candidateEnd <= eventStart) {
      // Candidate is before existing event
      gap = eventStart - candidateEnd;
    } else if (candidateStart >= eventEnd) {
      // Candidate is after existing event
      gap = candidateStart - eventEnd;
    } else {
      // Overlapping (shouldn't happen, but handle gracefully)
      gap = 0;
    }

    minGap = Math.min(minGap, gap);
  }

  // Convert gap to score:
  // 0 minutes gap = 1.0 (directly adjacent)
  // 30 minutes gap = 0.75
  // 60 minutes gap = 0.5
  // 120 minutes gap = 0.25
  // 180+ minutes gap = 0.0
  const maxGapMinutes = 180;
  return Math.max(0, 1 - minGap / maxGapMinutes);
}

/**
 * Helper to convert time string to minutes
 */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Calculate scarcity raw score
 * Returns 0-1 where:
 * - 0 = no impact on other teams
 * - 1 = this is another team's ONLY option
 *
 * Used with a negative weight to penalize taking scarce slots
 */
export function calculateScarcityRaw(
  candidate: PlacementCandidate,
  teamState: TeamSchedulingState,
  context: ScoringContext
): number {
  if (!context.teamSlotAvailability) {
    return 0; // No scarcity data available
  }

  // Create slot key for this candidate
  const slotKey = `${candidate.date}|${candidate.startTime}|${candidate.resourceId}`;
  let worstImpact = 0;

  for (const [otherTeamId, availableSlots] of context.teamSlotAvailability) {
    if (otherTeamId === teamState.teamId) continue;
    if (!availableSlots.has(slotKey)) continue;

    // This team could use this slot - how many alternatives do they have?
    const alternativeCount = availableSlots.size - 1;
    // 0 alternatives = impact 1.0, 1 alternative = 0.5, 2 = 0.33, etc.
    const impact = 1 / (alternativeCount + 1);
    worstImpact = Math.max(worstImpact, impact);
  }

  return worstImpact;
}

/**
 * Calculate same-day cage+field gap raw score
 * Returns 0-1 where:
 * - 0 = no cage+field on same day, OR they are adjacent (no penalty)
 * - 1 = cage+field on same day with a gap between them (full penalty)
 *
 * This ensures that if a team has both cage and field events on the same day,
 * they must be in adjacent time slots.
 */
export function calculateSameDayCageFieldGapRaw(
  candidate: PlacementCandidate,
  teamState: TeamSchedulingState,
  context: ScoringContext
): number {
  const isCageCandidate = candidate.resourceType === 'cage';

  // Check if placing cage event and team has field event on same day (or vice versa)
  const oppositeTypeDatesUsed = isCageCandidate ? teamState.fieldDatesUsed : teamState.cageDatesUsed;

  if (!oppositeTypeDatesUsed.has(candidate.date)) {
    // No opposite-type event on this day, no penalty
    return 0;
  }

  // Find the opposite-type events on this date - use team index if available
  let oppositeTypeEvents: ScheduledEventDraft[];
  if (context.eventsByDateTeam) {
    const key = `${candidate.date}-${teamState.teamId}`;
    const teamEventsOnDate = context.eventsByDateTeam.get(key) || [];
    oppositeTypeEvents = teamEventsOnDate.filter((e) => {
      if (isCageCandidate) {
        // Candidate is cage, look for field events (has fieldId, no cageId)
        return e.fieldId && !e.cageId;
      } else {
        // Candidate is field, look for cage events
        return e.cageId && !e.fieldId;
      }
    });
  } else {
    oppositeTypeEvents = context.scheduledEvents.filter((e) => {
      if (e.date !== candidate.date) return false;
      // Get the team ID for this scheduled event
      const eventTeamId = e.teamId || e.homeTeamId;
      if (eventTeamId !== teamState.teamId) return false;
      // Check if it's the opposite resource type
      if (isCageCandidate) {
        // Candidate is cage, look for field events (has fieldId, no cageId)
        return e.fieldId && !e.cageId;
      } else {
        // Candidate is field, look for cage events
        return e.cageId && !e.fieldId;
      }
    });
  }

  if (oppositeTypeEvents.length === 0) {
    // No opposite-type events found for this team on this date
    return 0;
  }

  // Calculate the minimum gap to any opposite-type event
  const candidateStart = timeToMinutes(candidate.startTime);
  const candidateEnd = timeToMinutes(candidate.endTime);

  let minGap = Infinity;

  for (const event of oppositeTypeEvents) {
    const eventStart = timeToMinutes(event.startTime);
    const eventEnd = timeToMinutes(event.endTime);

    // Calculate gap between candidate and existing event
    let gap: number;
    if (candidateEnd <= eventStart) {
      // Candidate is before existing event
      gap = eventStart - candidateEnd;
    } else if (candidateStart >= eventEnd) {
      // Candidate is after existing event
      gap = candidateStart - eventEnd;
    } else {
      // Overlapping (shouldn't happen)
      gap = 0;
    }

    minGap = Math.min(minGap, gap);
  }

  // If adjacent (0-15 min gap), no penalty
  // If gap exists, full penalty (we use a harsh threshold since adjacent is required)
  const adjacentThreshold = 15; // Allow small 15 min buffer
  if (minGap <= adjacentThreshold) {
    return 0;
  }

  // Any gap > 15 minutes is a full penalty
  return 1;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get the week number for a date
 */
function getWeekNumber(
  date: string,
  weekDefinitions: Array<{ weekNumber: number; startDate: string; endDate: string }>
): number {
  for (const week of weekDefinitions) {
    if (date >= week.startDate && date <= week.endDate) {
      return week.weekNumber;
    }
  }
  return -1;
}

/**
 * Create an empty scoring context
 */
export function createScoringContext(): ScoringContext {
  return {
    teamStates: new Map(),
    resourceUsage: new Map(),
    resourceCapacity: new Map(),
    gameDayPreferences: new Map(),
    fieldPreferences: new Map(),
    weekDefinitions: [],
    scheduledEvents: [],
    divisionConfigs: new Map(),
    eventsByDateResource: new Map(),
    eventsByDateTeam: new Map(),
  };
}

/**
 * Update indexes after adding an event (for fast conflict checking)
 * Note: This does NOT add to scheduledEvents - the caller manages that array
 */
export function addEventToContext(
  context: ScoringContext,
  event: ScheduledEventDraft
): void {
  // Update resource index
  const resourceId = event.fieldId || event.cageId;
  if (resourceId && context.eventsByDateResource) {
    const resourceKey = `${event.date}-${resourceId}`;
    if (!context.eventsByDateResource.has(resourceKey)) {
      context.eventsByDateResource.set(resourceKey, []);
    }
    context.eventsByDateResource.get(resourceKey)!.push(event);
  }

  // Update team index
  if (context.eventsByDateTeam) {
    const teamIds = [event.teamId, event.homeTeamId, event.awayTeamId].filter(Boolean) as string[];
    for (const teamId of teamIds) {
      const teamKey = `${event.date}-${teamId}`;
      if (!context.eventsByDateTeam.has(teamKey)) {
        context.eventsByDateTeam.set(teamKey, []);
      }
      context.eventsByDateTeam.get(teamKey)!.push(event);
    }
  }
}

/**
 * Update resource usage after scheduling an event
 */
export function updateResourceUsage(
  context: ScoringContext,
  resourceId: string,
  date: string,
  durationHours: number
): void {
  if (!context.resourceUsage.has(resourceId)) {
    context.resourceUsage.set(resourceId, new Map());
  }
  const dateMap = context.resourceUsage.get(resourceId)!;
  const current = dateMap.get(date) || 0;
  dateMap.set(date, current + durationHours);
}

/**
 * Generate a slot key for scarcity tracking
 * This should match the format used in calculateScarcityRaw
 */
export function generateSlotKey(date: string, startTime: string, resourceId: string): string {
  return `${date}|${startTime}|${resourceId}`;
}
