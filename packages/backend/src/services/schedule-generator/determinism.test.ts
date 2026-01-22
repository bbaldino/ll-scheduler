import { describe, it, expect } from 'vitest';
import { ScheduleGenerator } from './generator.js';
import fixture from './__fixtures__/spring-2026.json';

// Conversion functions
function convertSeason(row: any) {
  return {
    id: row.id, name: row.name, startDate: row.start_date, endDate: row.end_date,
    gamesStartDate: row.games_start_date, status: row.status,
    blackoutDates: row.blackout_dates || [], createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function convertDivision(row: any) {
  return {
    id: row.id, name: row.name, schedulingOrder: row.scheduling_order,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function parseJsonField(value: any, defaultValue: any = []) {
  if (value === null || value === undefined || value === 'null') return defaultValue;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return defaultValue; } }
  return value;
}

function convertDivisionConfig(row: any) {
  return {
    id: row.id, divisionId: row.division_id, seasonId: row.season_id,
    practicesPerWeek: row.practices_per_week, practiceDurationHours: row.practice_duration_hours,
    gamesPerWeek: row.games_per_week, gameDurationHours: row.game_duration_hours,
    gameArriveBeforeHours: row.game_arrive_before_hours,
    gameDayPreferences: parseJsonField(row.game_day_preferences, []),
    minConsecutiveDayGap: parseJsonField(row.min_consecutive_day_gap, null),
    cageSessionsPerWeek: parseJsonField(row.cage_sessions_per_week, null),
    cageSessionDurationHours: parseJsonField(row.cage_session_duration_hours, null),
    fieldPreferences: parseJsonField(row.field_preferences, []),
    gameWeekOverrides: parseJsonField(row.game_week_overrides, []),
    maxGamesPerSeason: row.max_games_per_season, maxGamesPerWeek: row.max_games_per_week,
    sundayPairedPracticeEnabled: row.sunday_paired_practice_enabled === 1,
    sundayPairedPracticeDurationHours: parseJsonField(row.sunday_paired_practice_duration_hours, null),
    sundayPairedPracticeFieldId: parseJsonField(row.sunday_paired_practice_field_id, null),
    sundayPairedPracticeCageId: parseJsonField(row.sunday_paired_practice_cage_id, null),
    gameSpacingEnabled: row.game_spacing_enabled === 1,
    practiceArriveBeforeMinutes: row.practice_arrive_before_minutes,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function convertTeam(row: any) {
  return { id: row.id, seasonId: row.season_id, name: row.name, divisionId: row.division_id,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function convertSeasonField(row: any, fields: any[]) {
  const field = fields.find((f: any) => f.id === row.field_id);
  return {
    id: row.id, seasonId: row.season_id, fieldId: row.field_id, fieldName: field?.name,
    divisionCompatibility: parseJsonField(field?.division_compatibility, []),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function convertSeasonCage(row: any, cages: any[]) {
  const cage = cages.find((c: any) => c.id === row.cage_id);
  return {
    id: row.id, seasonId: row.season_id, cageId: row.cage_id, cageName: cage?.name,
    divisionCompatibility: parseJsonField(cage?.division_compatibility, []),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function convertFieldAvailability(row: any) {
  return {
    id: row.id, seasonFieldId: row.season_field_id, dayOfWeek: row.day_of_week,
    startTime: row.start_time, endTime: row.end_time, singleEventOnly: row.single_event_only === 1,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function convertCageAvailability(row: any) {
  return {
    id: row.id, seasonCageId: row.season_cage_id, dayOfWeek: row.day_of_week,
    startTime: row.start_time, endTime: row.end_time, singleEventOnly: row.single_event_only === 1,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function convertFieldOverride(row: any) {
  return {
    id: row.id, seasonFieldId: row.season_field_id, date: row.date,
    overrideType: row.override_type || (row.is_blocked === 1 ? 'blackout' : 'added'),
    startTime: row.start_time, endTime: row.end_time, reason: row.reason,
    singleEventOnly: row.single_event_only === 1, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function convertCageOverride(row: any) {
  return {
    id: row.id, seasonCageId: row.season_cage_id, date: row.date,
    overrideType: row.override_type || (row.is_blocked === 1 ? 'blackout' : 'added'),
    startTime: row.start_time, endTime: row.end_time, reason: row.reason,
    singleEventOnly: row.single_event_only === 1, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function createFingerprint(events: any[]): string {
  const sorted = events
    .map(e => {
      const teamPart = e.homeTeamId ? `${e.homeTeamId}|${e.awayTeamId}` : e.teamId;
      const resourcePart = e.fieldId || e.cageId || '';
      return `${e.eventType}|${e.date}|${e.startTime}|${e.endTime}|${teamPart}|${resourcePart}`;
    })
    .sort()
    .join('\n');

  // Simple hash
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return `events=${events.length},hash=${hash}`;
}

async function runGeneration(): Promise<{ fingerprint: string; events: any[] }> {
  const season = convertSeason(fixture.season);
  const divisions = fixture.divisions.map(convertDivision).sort((a, b) => a.schedulingOrder - b.schedulingOrder);
  const divisionConfigs = fixture.divisionConfigs.map(convertDivisionConfig);
  const teams = fixture.teams.map(convertTeam);
  const seasonFields = fixture.seasonFields.map(sf => convertSeasonField(sf, fixture.fields));
  const seasonCages = fixture.seasonCages.map(sc => convertSeasonCage(sc, fixture.cages));
  const fieldAvailabilities = fixture.fieldAvailabilities.map(convertFieldAvailability);
  const cageAvailabilities = fixture.cageAvailabilities.map(convertCageAvailability);
  const fieldOverrides = fixture.fieldOverrides.map(convertFieldOverride);
  const cageOverrides = fixture.cageOverrides.map(convertCageOverride);

  const generator = new ScheduleGenerator(
    season, divisions, divisionConfigs, teams, seasonFields, seasonCages,
    fieldAvailabilities, cageAvailabilities, fieldOverrides, cageOverrides
  );

  await generator.generate();
  const events = generator.getScheduledEvents();

  return {
    fingerprint: createFingerprint(events),
    events
  };
}

describe('Schedule Determinism', () => {
  it('should produce identical results across 5 consecutive runs', async () => {
    const results: string[] = [];

    for (let i = 0; i < 5; i++) {
      const { fingerprint } = await runGeneration();
      results.push(fingerprint);
      console.log(`Run ${i + 1}: ${fingerprint}`);
    }

    const allSame = results.every(r => r === results[0]);
    console.log(`\nAll runs identical: ${allSame ? 'YES' : 'NO'}`);

    if (!allSame) {
      const unique = [...new Set(results)];
      console.log('Unique results:', unique);
    }

    expect(allSame, 'Schedule generation should be deterministic').toBe(true);
  });

  it('should produce identical event-by-event results', async () => {
    const run1 = await runGeneration();
    const run2 = await runGeneration();

    console.log(`Run 1: ${run1.events.length} events`);
    console.log(`Run 2: ${run2.events.length} events`);

    expect(run1.events.length).toBe(run2.events.length);

    // Sort both for comparison
    const sort = (events: any[]) => events.map(e => {
      const teamPart = e.homeTeamId ? `${e.homeTeamId}|${e.awayTeamId}` : e.teamId;
      return `${e.eventType}|${e.date}|${e.startTime}|${teamPart}`;
    }).sort();

    const sorted1 = sort(run1.events);
    const sorted2 = sort(run2.events);

    let differences = 0;
    for (let i = 0; i < sorted1.length; i++) {
      if (sorted1[i] !== sorted2[i]) {
        differences++;
        if (differences <= 5) {
          console.log(`Diff at ${i}: "${sorted1[i]}" vs "${sorted2[i]}"`);
        }
      }
    }

    console.log(`Total differences: ${differences}`);
    expect(differences).toBe(0);
  });
});
