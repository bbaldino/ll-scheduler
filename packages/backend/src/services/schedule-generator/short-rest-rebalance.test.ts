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

// Helper to parse JSON fields that might be stored as strings
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

// Calculate short rest violations per team (games with ≤2 day gaps)
function calculateShortRestViolations(
  games: Array<{ date: string; homeTeamId?: string; awayTeamId?: string }>,
  divisionTeamIds: Set<string>
): Map<string, number> {
  const teamGameDates = new Map<string, string[]>();

  for (const game of games) {
    if (game.homeTeamId && divisionTeamIds.has(game.homeTeamId)) {
      if (!teamGameDates.has(game.homeTeamId)) teamGameDates.set(game.homeTeamId, []);
      teamGameDates.get(game.homeTeamId)!.push(game.date);
    }
    if (game.awayTeamId && divisionTeamIds.has(game.awayTeamId)) {
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

function getShortRestDelta(violations: Map<string, number>): number {
  const counts = Array.from(violations.values());
  if (counts.length === 0) return 0;
  return Math.max(...counts) - Math.min(...counts);
}

describe('Short Rest Rebalancing with Real Data', () => {
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

  beforeAll(() => {
    // Convert fixture data to application types
    season = convertSeason(fixture.season);
    // Sort divisions by schedulingOrder (lower = higher priority, scheduled first)
    divisions = fixture.divisions.map(convertDivision).sort((a, b) => a.schedulingOrder - b.schedulingOrder);
    divisionConfigs = fixture.divisionConfigs.map(convertDivisionConfig);
    teams = fixture.teams.map(convertTeam);
    seasonFields = fixture.seasonFields.map((sf) => convertSeasonField(sf, fixture.fields));
    seasonCages = fixture.seasonCages.map((sc) => convertSeasonCage(sc, fixture.cages));
    fieldAvailabilities = fixture.fieldAvailabilities.map(convertFieldAvailability);
    cageAvailabilities = fixture.cageAvailabilities.map(convertCageAvailability);
    fieldOverrides = fixture.fieldOverrides.map(convertFieldOverride);
    cageOverrides = fixture.cageOverrides.map(convertCageOverride);
  });

  it('should have short rest delta <= 1 for all game-spacing divisions after generation', async () => {
    // Create the generator
    const generator = new ScheduleGenerator(
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

    // Generate the schedule
    const result = await generator.generate();

    expect(result.success).toBe(true);

    // Get scheduled games
    const scheduledGames = generator.getScheduledEvents().filter(e => e.eventType === 'game');

    // Check short rest delta for each game-spacing division
    for (const config of divisionConfigs) {
      if (!config.gameSpacingEnabled) continue;

      const division = divisions.find(d => d.id === config.divisionId);
      const divisionTeams = teams.filter(t => t.divisionId === config.divisionId);
      const divisionTeamIds = new Set(divisionTeams.map(t => t.id));

      const divisionGames = scheduledGames.filter(g =>
        g.divisionId === config.divisionId
      );

      const violations = calculateShortRestViolations(divisionGames, divisionTeamIds);
      const delta = getShortRestDelta(violations);

      const violationsSummary = Array.from(violations.entries())
        .map(([teamId, count]) => {
          const team = divisionTeams.find(t => t.id === teamId);
          return `${team?.name || teamId}:${count}`;
        })
        .join(', ');

      console.log(`${division?.name}: delta=${delta} [${violationsSummary}]`);

      expect(delta, `${division?.name} should have short rest delta <= 1`).toBeLessThanOrEqual(1);
    }
  });

  it('should not have any team with two games on the same day', async () => {
    const generator = new ScheduleGenerator(
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

    const scheduledGames = generator.getScheduledEvents().filter(e => e.eventType === 'game');

    // Check for same-day games per team
    const teamGamesByDate = new Map<string, Map<string, number>>();

    for (const game of scheduledGames) {
      for (const teamId of [game.homeTeamId, game.awayTeamId]) {
        if (!teamId) continue;
        if (!teamGamesByDate.has(teamId)) {
          teamGamesByDate.set(teamId, new Map());
        }
        const dateMap = teamGamesByDate.get(teamId)!;
        dateMap.set(game.date, (dateMap.get(game.date) || 0) + 1);
      }
    }

    const violations: string[] = [];
    for (const [teamId, dateMap] of teamGamesByDate) {
      for (const [date, count] of dateMap) {
        if (count > 1) {
          const team = teams.find(t => t.id === teamId);
          violations.push(`${team?.name || teamId} has ${count} games on ${date}`);
        }
      }
    }

    expect(violations, `Same-day game violations: ${violations.join(', ')}`).toHaveLength(0);
  });
});
