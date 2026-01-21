import { describe, it, expect, beforeAll } from 'vitest';
import { ScheduleGenerator } from './generator.js';
import fixture from './__fixtures__/spring-2026.json';
import type {
  Season,
  Division,
  DivisionConfig,
  Team,
  SeasonField,
  SeasonCage,
  FieldAvailability,
  CageAvailability,
  FieldDateOverride,
  CageDateOverride,
} from '@ll-scheduler/shared';

// Helper to convert DB row format to application types
function convertSeason(row: any): Season {
  let blackoutDates = row.blackout_dates || [];
  if (typeof blackoutDates === 'string') {
    try {
      blackoutDates = JSON.parse(blackoutDates);
    } catch {
      blackoutDates = [];
    }
  }
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    gamesStartDate: row.games_start_date,
    status: row.status,
    blackoutDates,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertDivision(row: any): Division {
  return {
    id: row.id,
    name: row.name,
    schedulingOrder: row.scheduling_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonField(value: any, defaultValue: any = []): any {
  if (value === null || value === undefined || value === 'null') {
    return defaultValue;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return defaultValue;
    }
  }
  return value;
}

function convertDivisionConfig(row: any): DivisionConfig {
  return {
    id: row.id,
    divisionId: row.division_id,
    seasonId: row.season_id,
    practicesPerWeek: row.practices_per_week,
    practiceDurationHours: row.practice_duration_hours,
    gamesPerWeek: row.games_per_week,
    gameDurationHours: row.game_duration_hours,
    gameArriveBeforeHours: row.game_arrive_before_hours,
    gameDayPreferences: parseJsonField(row.game_day_preferences, []),
    minConsecutiveDayGap: parseJsonField(row.min_consecutive_day_gap, null),
    cageSessionsPerWeek: parseJsonField(row.cage_sessions_per_week, null),
    cageSessionDurationHours: parseJsonField(row.cage_session_duration_hours, null),
    fieldPreferences: parseJsonField(row.field_preferences, []),
    gameWeekOverrides: parseJsonField(row.game_week_overrides, []),
    maxGamesPerSeason: row.max_games_per_season,
    maxGamesPerWeek: row.max_games_per_week,
    sundayPairedPracticeEnabled: row.sunday_paired_practice_enabled === 1,
    sundayPairedPracticeDurationHours: parseJsonField(row.sunday_paired_practice_duration_hours, null),
    sundayPairedPracticeFieldId: parseJsonField(row.sunday_paired_practice_field_id, null),
    sundayPairedPracticeCageId: parseJsonField(row.sunday_paired_practice_cage_id, null),
    gameSpacingEnabled: row.game_spacing_enabled === 1,
    practiceArriveBeforeMinutes: row.practice_arrive_before_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertTeam(row: any): Team {
  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    divisionId: row.division_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertSeasonField(row: any): SeasonField {
  return {
    id: row.id,
    seasonId: row.season_id,
    fieldId: row.field_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertSeasonCage(row: any): SeasonCage {
  return {
    id: row.id,
    seasonId: row.season_id,
    cageId: row.cage_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertFieldAvailability(row: any): FieldAvailability {
  return {
    id: row.id,
    seasonFieldId: row.season_field_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    singleEventOnly: row.single_event_only === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertCageAvailability(row: any): CageAvailability {
  return {
    id: row.id,
    seasonCageId: row.season_cage_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    singleEventOnly: row.single_event_only === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertFieldOverride(row: any): FieldDateOverride {
  return {
    id: row.id,
    seasonFieldId: row.season_field_id,
    date: row.date,
    overrideType: row.override_type || (row.is_blocked === 1 ? 'blackout' : 'added'),
    startTime: row.start_time,
    endTime: row.end_time,
    reason: row.reason,
    singleEventOnly: row.single_event_only === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertCageOverride(row: any): CageDateOverride {
  return {
    id: row.id,
    seasonCageId: row.season_cage_id,
    date: row.date,
    overrideType: row.override_type || (row.is_blocked === 1 ? 'blackout' : 'added'),
    startTime: row.start_time,
    endTime: row.end_time,
    reason: row.reason,
    singleEventOnly: row.single_event_only === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============= METRIC CALCULATION HELPERS =============

interface GameEvent {
  date: string;
  homeTeamId?: string;
  awayTeamId?: string;
  divisionId: string;
  teamId?: string;
}

/**
 * Calculate short rest violations per team (games with ≤2 day gaps)
 */
function calculateShortRestViolations(
  games: GameEvent[],
  teamIds: Set<string>
): Map<string, number> {
  const teamGameDates = new Map<string, string[]>();

  for (const game of games) {
    if (game.homeTeamId && teamIds.has(game.homeTeamId)) {
      if (!teamGameDates.has(game.homeTeamId)) teamGameDates.set(game.homeTeamId, []);
      teamGameDates.get(game.homeTeamId)!.push(game.date);
    }
    if (game.awayTeamId && teamIds.has(game.awayTeamId)) {
      if (!teamGameDates.has(game.awayTeamId)) teamGameDates.set(game.awayTeamId, []);
      teamGameDates.get(game.awayTeamId)!.push(game.date);
    }
  }

  const violations = new Map<string, number>();
  for (const [teamId, dates] of teamGameDates) {
    const sortedDates = [...new Set(dates)].sort();
    let count = 0;
    for (let i = 1; i < sortedDates.length; i++) {
      const d1 = new Date(sortedDates[i - 1]);
      const d2 = new Date(sortedDates[i]);
      const gap = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      if (gap <= 2) count++;
    }
    violations.set(teamId, count);
  }
  return violations;
}

/**
 * Calculate delta (max - min) of short rest violations
 */
function getShortRestDelta(violations: Map<string, number>): number {
  const counts = Array.from(violations.values());
  if (counts.length === 0) return 0;
  return Math.max(...counts) - Math.min(...counts);
}

/**
 * Calculate home/away balance per team
 * Returns map of teamId -> {home, away, diff}
 */
function calculateHomeAwayBalance(
  games: GameEvent[],
  teamIds: Set<string>
): Map<string, { home: number; away: number; diff: number }> {
  const balance = new Map<string, { home: number; away: number; diff: number }>();

  for (const teamId of teamIds) {
    balance.set(teamId, { home: 0, away: 0, diff: 0 });
  }

  for (const game of games) {
    if (game.homeTeamId && teamIds.has(game.homeTeamId)) {
      const b = balance.get(game.homeTeamId)!;
      b.home++;
      b.diff = Math.abs(b.home - b.away);
    }
    if (game.awayTeamId && teamIds.has(game.awayTeamId)) {
      const b = balance.get(game.awayTeamId)!;
      b.away++;
      b.diff = Math.abs(b.home - b.away);
    }
  }

  return balance;
}

/**
 * Calculate matchup spacing (days between games with same two teams)
 * Returns minimum spacing found for any matchup in the division
 */
function calculateMatchupSpacing(
  games: GameEvent[],
  divisionId: string
): { minSpacing: number; violations: Array<{ teams: string; gaps: number[] }>; hasMatchups: boolean } {
  const divisionGames = games.filter(g => g.divisionId === divisionId);

  // Group by matchup (normalized team pair)
  const gamesByMatchup = new Map<string, string[]>();
  for (const game of divisionGames) {
    if (!game.homeTeamId || !game.awayTeamId) continue;
    const key = [game.homeTeamId, game.awayTeamId].sort().join('|');
    if (!gamesByMatchup.has(key)) gamesByMatchup.set(key, []);
    gamesByMatchup.get(key)!.push(game.date);
  }

  let minSpacing = Infinity;
  const violations: Array<{ teams: string; gaps: number[] }> = [];
  let hasMatchupsWithMultipleGames = false;

  for (const [matchupKey, dates] of gamesByMatchup) {
    if (dates.length < 2) continue;
    hasMatchupsWithMultipleGames = true;
    const sortedDates = [...dates].sort();
    const gaps: number[] = [];

    for (let i = 1; i < sortedDates.length; i++) {
      const d1 = new Date(sortedDates[i - 1]);
      const d2 = new Date(sortedDates[i]);
      const gap = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      gaps.push(gap);
      minSpacing = Math.min(minSpacing, gap);
    }

    // Track violations (gaps < 7 days)
    if (gaps.some(g => g < 7)) {
      violations.push({ teams: matchupKey, gaps });
    }
  }

  return {
    minSpacing: minSpacing === Infinity ? -1 : minSpacing, // -1 means no matchups with multiple games
    violations,
    hasMatchups: hasMatchupsWithMultipleGames
  };
}

/**
 * Check for same-day game conflicts (team has 2+ games on same day)
 */
function findSameDayGameConflicts(
  games: GameEvent[],
  teamIds: Set<string>
): Array<{ teamId: string; date: string; count: number }> {
  const teamGamesByDate = new Map<string, Map<string, number>>();

  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!teamId || !teamIds.has(teamId)) continue;
      if (!teamGamesByDate.has(teamId)) {
        teamGamesByDate.set(teamId, new Map());
      }
      const dateMap = teamGamesByDate.get(teamId)!;
      dateMap.set(game.date, (dateMap.get(game.date) || 0) + 1);
    }
  }

  const conflicts: Array<{ teamId: string; date: string; count: number }> = [];
  for (const [teamId, dateMap] of teamGamesByDate) {
    for (const [date, count] of dateMap) {
      if (count > 1) {
        conflicts.push({ teamId, date, count });
      }
    }
  }
  return conflicts;
}

/**
 * Calculate per-opponent home/away balance (matchup balance)
 * Returns max imbalance found
 */
function calculateMatchupHomeAwayBalance(
  games: GameEvent[],
  divisionId: string
): { maxImbalance: number; violations: Array<{ matchup: string; home: number; away: number }> } {
  const divisionGames = games.filter(g => g.divisionId === divisionId);

  // Track per-matchup home/away counts
  const matchupBalance = new Map<string, { home: string; homeCount: number; awayCount: number }>();

  for (const game of divisionGames) {
    if (!game.homeTeamId || !game.awayTeamId) continue;
    const key = [game.homeTeamId, game.awayTeamId].sort().join('|');

    if (!matchupBalance.has(key)) {
      // First team alphabetically is tracked as "home" perspective
      const [first] = [game.homeTeamId, game.awayTeamId].sort();
      matchupBalance.set(key, { home: first, homeCount: 0, awayCount: 0 });
    }

    const balance = matchupBalance.get(key)!;
    if (game.homeTeamId === balance.home) {
      balance.homeCount++;
    } else {
      balance.awayCount++;
    }
  }

  let maxImbalance = 0;
  const violations: Array<{ matchup: string; home: number; away: number }> = [];

  for (const [matchup, balance] of matchupBalance) {
    const imbalance = Math.abs(balance.homeCount - balance.awayCount);
    maxImbalance = Math.max(maxImbalance, imbalance);
    if (imbalance > 1) {
      violations.push({ matchup, home: balance.homeCount, away: balance.awayCount });
    }
  }

  return { maxImbalance, violations };
}

// ============= TEST SUITE =============

describe('Schedule Generation Regression Tests', () => {
  let season: Season;
  let divisions: Division[];
  let divisionConfigs: DivisionConfig[];
  let teams: Team[];
  let seasonFields: SeasonField[];
  let seasonCages: SeasonCage[];
  let fieldAvailabilities: FieldAvailability[];
  let cageAvailabilities: CageAvailability[];
  let fieldOverrides: FieldDateOverride[];
  let cageOverrides: CageDateOverride[];

  let generator: ScheduleGenerator;
  let scheduledGames: GameEvent[];
  let divisionTeamMap: Map<string, Set<string>>;
  let divisionNameMap: Map<string, string>;

  beforeAll(async () => {
    // Convert fixture data to application types
    season = convertSeason(fixture.season);
    divisions = fixture.divisions.map(convertDivision);
    divisionConfigs = fixture.divisionConfigs.map(convertDivisionConfig);
    teams = fixture.teams.map(convertTeam);
    seasonFields = fixture.seasonFields.map(convertSeasonField);
    seasonCages = fixture.seasonCages.map(convertSeasonCage);
    fieldAvailabilities = fixture.fieldAvailabilities.map(convertFieldAvailability);
    cageAvailabilities = fixture.cageAvailabilities.map(convertCageAvailability);
    fieldOverrides = fixture.fieldOverrides.map(convertFieldOverride);
    cageOverrides = fixture.cageOverrides.map(convertCageOverride);

    // Build helper maps
    divisionTeamMap = new Map();
    divisionNameMap = new Map();
    for (const div of divisions) {
      divisionNameMap.set(div.id, div.name);
      divisionTeamMap.set(div.id, new Set(teams.filter(t => t.divisionId === div.id).map(t => t.id)));
    }

    // Create and run generator
    generator = new ScheduleGenerator(
      season,
      divisions,
      divisionConfigs,
      teams,
      seasonFields,
      seasonCages,
      fieldAvailabilities,
      cageAvailabilities,
      fieldOverrides,
      cageOverrides
    );

    const result = await generator.generate();
    expect(result.success).toBe(true);

    // Get scheduled games
    scheduledGames = generator.getScheduledEvents()
      .filter(e => e.eventType === 'game')
      .map(e => ({
        date: e.date,
        homeTeamId: e.homeTeamId,
        awayTeamId: e.awayTeamId,
        divisionId: e.divisionId,
        teamId: e.teamId,
      }));
  });

  describe('Debug: Game counts per division', () => {
    it('should log game counts per division', () => {
      const gameCountByDivision = new Map<string, number>();
      for (const game of scheduledGames) {
        const count = gameCountByDivision.get(game.divisionId) || 0;
        gameCountByDivision.set(game.divisionId, count + 1);
      }

      console.log('Games per division:');
      for (const div of divisions) {
        const count = gameCountByDivision.get(div.id) || 0;
        console.log(`  ${div.name}: ${count} games`);
      }

      // Just a check that we have games
      expect(scheduledGames.length).toBeGreaterThan(0);
    });
  });

  describe('Game Spacing (Short Rest) Delta', () => {
    // Majors short rest delta increased from 1 to 2 because short rest rebalancing
    // now respects matchup spacing (won't swap if it creates < 7 day same-matchup gap)
    it('Majors: short rest delta should be <= 2 (trade-off for matchup spacing)', () => {
      const divisionId = divisions.find(d => d.name === 'Majors')?.id;
      expect(divisionId).toBeDefined();

      const teamIds = divisionTeamMap.get(divisionId!)!;
      const violations = calculateShortRestViolations(scheduledGames, teamIds);
      const delta = getShortRestDelta(violations);

      const summary = Array.from(violations.entries())
        .map(([id, count]) => `${teams.find(t => t.id === id)?.name}: ${count}`)
        .join(', ');

      expect(delta, `Majors short rest delta=${delta} [${summary}]`).toBeLessThanOrEqual(2);
    });

    it('AAA: short rest delta should be <= 1', () => {
      const divisionId = divisions.find(d => d.name === 'AAA')?.id;
      expect(divisionId).toBeDefined();

      const teamIds = divisionTeamMap.get(divisionId!)!;
      const violations = calculateShortRestViolations(scheduledGames, teamIds);
      const delta = getShortRestDelta(violations);

      const summary = Array.from(violations.entries())
        .map(([id, count]) => `${teams.find(t => t.id === id)?.name}: ${count}`)
        .join(', ');

      expect(delta, `AAA short rest delta=${delta} [${summary}]`).toBeLessThanOrEqual(1);
    });

    it('AA: short rest delta should be <= 1', () => {
      const divisionId = divisions.find(d => d.name === 'AA')?.id;
      expect(divisionId).toBeDefined();

      const teamIds = divisionTeamMap.get(divisionId!)!;
      const violations = calculateShortRestViolations(scheduledGames, teamIds);
      const delta = getShortRestDelta(violations);

      const summary = Array.from(violations.entries())
        .map(([id, count]) => `${teams.find(t => t.id === id)?.name}: ${count}`)
        .join(', ');

      expect(delta, `AA short rest delta=${delta} [${summary}]`).toBeLessThanOrEqual(1);
    });

    it('A: short rest delta should be <= 1', () => {
      const divisionId = divisions.find(d => d.name === 'A')?.id;
      expect(divisionId).toBeDefined();

      const teamIds = divisionTeamMap.get(divisionId!)!;
      const violations = calculateShortRestViolations(scheduledGames, teamIds);
      const delta = getShortRestDelta(violations);

      const summary = Array.from(violations.entries())
        .map(([id, count]) => `${teams.find(t => t.id === id)?.name}: ${count}`)
        .join(', ');

      expect(delta, `A short rest delta=${delta} [${summary}]`).toBeLessThanOrEqual(1);
    });

    // Tball has fewer games per week (1 vs 2) which can lead to less flexibility
    // Current baseline: delta <= 2, goal is to improve to <= 1
    it('Tball: short rest delta should be <= 2 (current baseline)', () => {
      const divisionId = divisions.find(d => d.name === 'Tball')?.id;
      expect(divisionId).toBeDefined();

      const teamIds = divisionTeamMap.get(divisionId!)!;
      const violations = calculateShortRestViolations(scheduledGames, teamIds);
      const delta = getShortRestDelta(violations);

      const summary = Array.from(violations.entries())
        .map(([id, count]) => `${teams.find(t => t.id === id)?.name}: ${count}`)
        .join(', ');

      console.log(`Tball short rest: delta=${delta}, [${summary}]`);
      expect(delta, `Tball short rest delta=${delta} [${summary}]`).toBeLessThanOrEqual(2);
    });
  });

  describe('Same-Day Game Conflicts', () => {
    it('no team should have two games on the same day', () => {
      const allTeamIds = new Set(teams.map(t => t.id));
      const conflicts = findSameDayGameConflicts(scheduledGames, allTeamIds);

      const summary = conflicts.map(c => {
        const team = teams.find(t => t.id === c.teamId);
        return `${team?.name} has ${c.count} games on ${c.date}`;
      }).join(', ');

      expect(conflicts, `Same-day conflicts: ${summary}`).toHaveLength(0);
    });
  });

  describe('Home/Away Balance', () => {
    // Per-division home/away balance tests
    // Upper divisions (Majors/AAA/AA) should have strict balance
    // A and Tball have more games and sharing constraints may cause some imbalance

    for (const divName of ['Majors', 'AAA', 'AA']) {
      it(`${divName}: all teams should have home/away diff <= 1`, () => {
        const divisionId = divisions.find(d => d.name === divName)?.id;
        expect(divisionId).toBeDefined();

        const teamIds = divisionTeamMap.get(divisionId!)!;
        const balance = calculateHomeAwayBalance(scheduledGames, teamIds);

        const violations: string[] = [];
        for (const [teamId, b] of balance) {
          if (b.diff > 1) {
            const team = teams.find(t => t.id === teamId);
            violations.push(`${team?.name}: ${b.home}H/${b.away}A (diff=${b.diff})`);
          }
        }

        expect(violations, `${divName} home/away imbalances: ${violations.join(', ')}`).toHaveLength(0);
      });
    }

    // A and Tball share fields and have more scheduling constraints
    // Current baseline allows up to 3 diff, goal is to improve to ≤1
    it('A: max home/away diff should be <= 2 (current baseline)', () => {
      const divisionId = divisions.find(d => d.name === 'A')?.id;
      expect(divisionId).toBeDefined();

      const teamIds = divisionTeamMap.get(divisionId!)!;
      const balance = calculateHomeAwayBalance(scheduledGames, teamIds);

      let maxDiff = 0;
      for (const [_, b] of balance) {
        maxDiff = Math.max(maxDiff, b.diff);
      }

      expect(maxDiff, `A max home/away diff=${maxDiff}`).toBeLessThanOrEqual(2);
    });

    it('Tball: max home/away diff should be <= 3 (current baseline)', () => {
      const divisionId = divisions.find(d => d.name === 'Tball')?.id;
      expect(divisionId).toBeDefined();

      const teamIds = divisionTeamMap.get(divisionId!)!;
      const balance = calculateHomeAwayBalance(scheduledGames, teamIds);

      let maxDiff = 0;
      const breakdown: string[] = [];
      for (const [teamId, b] of balance) {
        const team = teams.find(t => t.id === teamId);
        breakdown.push(`${team?.name}: ${b.home}H/${b.away}A`);
        maxDiff = Math.max(maxDiff, b.diff);
      }

      console.log(`Tball home/away: ${breakdown.join(', ')}`);
      expect(maxDiff, `Tball max home/away diff=${maxDiff}`).toBeLessThanOrEqual(3);
    });
  });

  describe('Matchup Home/Away Balance', () => {
    for (const divName of ['Majors', 'AAA', 'AA', 'A', 'Tball']) {
      it(`${divName}: per-matchup home/away imbalance should be <= 1`, () => {
        const divisionId = divisions.find(d => d.name === divName)?.id;
        if (!divisionId) return; // Skip if division doesn't exist

        const { maxImbalance, violations } = calculateMatchupHomeAwayBalance(scheduledGames, divisionId);

        const summary = violations.map(v => `${v.matchup}: ${v.home}H/${v.away}A`).join(', ');

        expect(maxImbalance, `${divName} matchup imbalances: ${summary}`).toBeLessThanOrEqual(1);
      });
    }
  });

  describe('Matchup Spacing', () => {
    // These tests document current behavior - update thresholds as improvements are made
    // minSpacing of -1 means no matchups with multiple games were found (data issue)

    it('Majors: matchup spacing should be >= 7 days', () => {
      const divisionId = divisions.find(d => d.name === 'Majors')?.id;
      expect(divisionId).toBeDefined();

      const { minSpacing, violations, hasMatchups } = calculateMatchupSpacing(scheduledGames, divisionId!);

      const summary = violations.map(v => `${v.teams}: gaps=${v.gaps.join(',')}`).join('; ');
      console.log(`Majors matchup spacing: min=${minSpacing}, hasMatchups=${hasMatchups}, violations: ${summary || 'none'}`);

      if (hasMatchups) {
        expect(minSpacing, `Majors min matchup spacing=${minSpacing}`).toBeGreaterThanOrEqual(7);
      } else {
        console.log('  WARNING: No matchups with multiple games found for Majors - check fixture data');
      }
    });

    it('AAA: matchup spacing should be >= 7 days', () => {
      const divisionId = divisions.find(d => d.name === 'AAA')?.id;
      expect(divisionId).toBeDefined();

      const { minSpacing, violations, hasMatchups } = calculateMatchupSpacing(scheduledGames, divisionId!);

      const summary = violations.map(v => `${v.teams}: gaps=${v.gaps.join(',')}`).join('; ');
      console.log(`AAA matchup spacing: min=${minSpacing}, hasMatchups=${hasMatchups}, violations: ${summary || 'none'}`);

      if (hasMatchups) {
        expect(minSpacing, `AAA min matchup spacing=${minSpacing}`).toBeGreaterThanOrEqual(7);
      } else {
        console.log('  WARNING: No matchups with multiple games found for AAA - check fixture data');
      }
    });

    it('AA: matchup spacing should be >= 7 days', () => {
      const divisionId = divisions.find(d => d.name === 'AA')?.id;
      expect(divisionId).toBeDefined();

      const { minSpacing, violations, hasMatchups } = calculateMatchupSpacing(scheduledGames, divisionId!);

      const summary = violations.map(v => `${v.teams}: gaps=${v.gaps.join(',')}`).join('; ');
      console.log(`AA matchup spacing: min=${minSpacing}, hasMatchups=${hasMatchups}, violations: ${summary || 'none'}`);

      if (hasMatchups) {
        expect(minSpacing, `AA min matchup spacing=${minSpacing}`).toBeGreaterThanOrEqual(7);
      } else {
        console.log('  WARNING: No matchups with multiple games found for AA - check fixture data');
      }
    });

    // A has competition group constraints that make spacing harder
    // Matchup spacing scoring helps but randomness still causes variability
    // Improved from >= 2 days to >= 4 days with matchup spacing scoring
    it('A: matchup spacing should be >= 4 days (improved from 2)', () => {
      const divisionId = divisions.find(d => d.name === 'A')?.id;
      expect(divisionId).toBeDefined();

      const { minSpacing, violations, hasMatchups } = calculateMatchupSpacing(scheduledGames, divisionId!);

      const summary = violations.map(v => `${v.teams}: gaps=${v.gaps.join(',')}`).join('; ');
      console.log(`A matchup spacing: min=${minSpacing}, hasMatchups=${hasMatchups}, violations: ${summary || 'none'}`);

      expect(hasMatchups, 'A should have matchups with multiple games').toBe(true);
      // Target is >= 7 days but competition group constraints + randomness cause variability
      // Typically achieves 5-8 days but can hit 4-5 days in worst case
      expect(minSpacing, `A min matchup spacing=${minSpacing}`).toBeGreaterThanOrEqual(4);
    });

    it('Tball: matchup spacing (current baseline >= 3 days)', () => {
      const divisionId = divisions.find(d => d.name === 'Tball')?.id;
      expect(divisionId).toBeDefined();

      const { minSpacing, violations, hasMatchups } = calculateMatchupSpacing(scheduledGames, divisionId!);

      const summary = violations.map(v => `${v.teams}: gaps=${v.gaps.join(',')}`).join('; ');
      console.log(`Tball matchup spacing: min=${minSpacing}, hasMatchups=${hasMatchups}, violations: ${summary || 'none'}`);

      expect(hasMatchups, 'Tball should have matchups with multiple games').toBe(true);
      // Current baseline: minSpacing around 3 days
      // TODO: Improve to >= 7 days
      expect(minSpacing, `Tball min matchup spacing=${minSpacing}`).toBeGreaterThanOrEqual(3);
    });
  });
});
