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

function convertSeasonField(row: any, fields: any[]): SeasonField {
  // Look up the field to get divisionCompatibility and fieldName
  const field = fields.find((f: any) => f.id === row.field_id);
  let divisionCompatibility: string[] = [];
  if (field?.division_compatibility) {
    divisionCompatibility = parseJsonField(field.division_compatibility, []);
  }
  return {
    id: row.id,
    seasonId: row.season_id,
    fieldId: row.field_id,
    fieldName: field?.name,
    divisionCompatibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertSeasonCage(row: any, cages: any[]): SeasonCage {
  // Look up the cage to get divisionCompatibility and cageName
  const cage = cages.find((c: any) => c.id === row.cage_id);
  let divisionCompatibility: string[] = [];
  if (cage?.division_compatibility) {
    divisionCompatibility = parseJsonField(cage.division_compatibility, []);
  }
  return {
    id: row.id,
    seasonId: row.season_id,
    cageId: row.cage_id,
    cageName: cage?.name,
    divisionCompatibility,
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
    // Sort divisions by schedulingOrder (lower = higher priority, scheduled first)
    divisions = fixture.divisions.map(convertDivision).sort((a, b) => a.schedulingOrder - b.schedulingOrder);
    divisionConfigs = fixture.divisionConfigs.map(convertDivisionConfig);
    teams = fixture.teams.map(convertTeam);
    seasonFields = fixture.seasonFields.map(sf => convertSeasonField(sf, fixture.fields));
    seasonCages = fixture.seasonCages.map(sc => convertSeasonCage(sc, fixture.cages));
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

    it('should have no field overlaps on any day', () => {
      const allEvents = generator.getScheduledEvents();

      // Only check events with a fieldId (games and practices, not cage sessions)
      const fieldEvents = allEvents.filter(e => e.fieldId);

      // Group by date and field
      const byDateAndField = new Map<string, typeof allEvents>();
      for (const e of fieldEvents) {
        const key = `${e.date}|${e.fieldId}`;
        if (!byDateAndField.has(key)) byDateAndField.set(key, []);
        byDateAndField.get(key)!.push(e);
      }

      // Check for overlaps within each date/field combination
      const overlaps: string[] = [];
      for (const [key, events] of byDateAndField) {
        const [date, fieldId] = key.split('|');
        for (let i = 0; i < events.length; i++) {
          for (let j = i + 1; j < events.length; j++) {
            const a = events[i];
            const b = events[j];
            if (a.startTime < b.endTime && b.startTime < a.endTime) {
              const divNameA = divisions.find(d => d.id === a.divisionId)?.name || a.divisionId;
              const divNameB = divisions.find(d => d.id === b.divisionId)?.name || b.divisionId;
              overlaps.push(`${date} field ${fieldId}: ${divNameA} (${a.startTime}-${a.endTime}) vs ${divNameB} (${b.startTime}-${b.endTime})`);
            }
          }
        }
      }

      if (overlaps.length > 0) {
        console.log('Field overlaps found:');
        for (const o of overlaps) {
          console.log(`  ${o}`);
        }
      }

      expect(overlaps.length, `Found ${overlaps.length} field overlaps`).toBe(0);
    });
  });

  describe('Game Count Balance Per Team', () => {
    for (const divName of ['A', 'AA', 'AAA', 'Majors', 'Tball']) {
      it(`${divName}: game count delta between teams should be <= 1`, () => {
        const divisionId = divisions.find(d => d.name === divName)?.id;
        expect(divisionId).toBeDefined();

        const teamIds = divisionTeamMap.get(divisionId!)!;
        const teamGames = new Map<string, number>();

        for (const teamId of teamIds) {
          const count = scheduledGames.filter(g =>
            g.divisionId === divisionId && (g.homeTeamId === teamId || g.awayTeamId === teamId)
          ).length;
          teamGames.set(teamId, count);
        }

        const counts = Array.from(teamGames.values());
        const minGames = Math.min(...counts);
        const maxGames = Math.max(...counts);
        const delta = maxGames - minGames;

        const summary = Array.from(teamGames.entries())
          .map(([teamId, count]) => {
            const team = teams.find(t => t.id === teamId);
            return `${team?.name || teamId}: ${count}`;
          })
          .join(', ');

        console.log(`${divName} game counts: ${summary}, delta=${delta}`);

        expect(delta, `${divName} game count delta`).toBeLessThanOrEqual(1);
      });
    }
  });

  describe('Game Spacing (Short Rest) Delta', () => {
    for (const divName of ['A', 'AA', 'AAA', 'Majors', 'Tball']) {
      it(`${divName}: short rest delta should be <= 1`, () => {
        const divisionId = divisions.find(d => d.name === divName)?.id;
        expect(divisionId).toBeDefined();

        const teamIds = divisionTeamMap.get(divisionId!)!;
        const violations = calculateShortRestViolations(scheduledGames, teamIds);
        const delta = getShortRestDelta(violations);

        const summary = Array.from(violations.entries())
          .map(([id, count]) => `${teams.find(t => t.id === id)?.name}: ${count}`)
          .join(', ');

        console.log(`${divName} short rest: delta=${delta}, [${summary}]`);
        expect(delta, `${divName} short rest delta=${delta} [${summary}]`).toBeLessThanOrEqual(1);
      });
    }
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
    for (const divName of ['A', 'AA', 'AAA', 'Majors', 'Tball']) {
      it(`${divName}: all teams should have home/away diff <= 1`, () => {
        const divisionId = divisions.find(d => d.name === divName)?.id;
        expect(divisionId).toBeDefined();

        const teamIds = divisionTeamMap.get(divisionId!)!;
        const balance = calculateHomeAwayBalance(scheduledGames, teamIds);

        const breakdown: string[] = [];
        const violations: string[] = [];
        for (const [teamId, b] of balance) {
          const team = teams.find(t => t.id === teamId);
          breakdown.push(`${team?.name}: ${b.home}H/${b.away}A`);
          if (b.diff > 1) {
            violations.push(`${team?.name}: ${b.home}H/${b.away}A (diff=${b.diff})`);
          }
        }

        console.log(`${divName} home/away: ${breakdown.join(', ')}`);
        expect(violations, `${divName} home/away imbalances: ${violations.join(', ')}`).toHaveLength(0);
      });
    }
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
    for (const divName of ['A', 'AA', 'AAA', 'Majors', 'Tball']) {
      it(`${divName}: matchup spacing should be >= 7 days`, () => {
        const divisionId = divisions.find(d => d.name === divName)?.id;
        expect(divisionId).toBeDefined();

        const { minSpacing, violations, hasMatchups } = calculateMatchupSpacing(scheduledGames, divisionId!);

        const summary = violations.map(v => `${v.teams}: gaps=${v.gaps.join(',')}`).join('; ');
        console.log(`${divName} matchup spacing: min=${minSpacing}, hasMatchups=${hasMatchups}, violations: ${summary || 'none'}`);

        expect(hasMatchups, `${divName} should have matchups with multiple games`).toBe(true);
        expect(minSpacing, `${divName} min matchup spacing=${minSpacing}`).toBeGreaterThanOrEqual(7);
      });
    }
  });
});
