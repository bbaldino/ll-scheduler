import { describe, it } from 'vitest';
import { ScheduleGenerator } from './generator.js';
import fixture from './__fixtures__/spring-2026-prod.json';

// Conversion functions
function parseJsonField(value: any, defaultValue: any = []) {
  if (value === null || value === undefined || value === 'null') return defaultValue;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return defaultValue; } }
  return value;
}

function convertSeason(row: any) {
  return {
    id: row.id, name: row.name, startDate: row.start_date, endDate: row.end_date,
    gamesStartDate: row.games_start_date, status: row.status,
    blackoutDates: parseJsonField(row.blackout_dates, []), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function convertDivision(row: any) {
  return {
    id: row.id, name: row.name, schedulingOrder: row.scheduling_order,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
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

describe('Production Data Gap Analysis', () => {
  it('should analyze game gaps per division with production data', async () => {
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

    console.log('\n=== Production Data Summary ===');
    console.log(`Season: ${season.name}`);
    console.log(`Divisions: ${divisions.length}`);
    console.log(`Teams: ${teams.length}`);
    console.log(`Fields: ${seasonFields.length}`);
    console.log(`Field Availabilities: ${fieldAvailabilities.length}`);
    console.log(`Field Overrides: ${fieldOverrides.length}`);

    for (const div of divisions) {
      const config = divisionConfigs.find(c => c.divisionId === div.id);
      const divTeams = teams.filter(t => t.divisionId === div.id);
      console.log(`  ${div.name}: ${divTeams.length} teams, gameSpacing=${config?.gameSpacingEnabled}`);
    }

    const generator = new ScheduleGenerator(
      season, divisions, divisionConfigs, teams, seasonFields, seasonCages,
      fieldAvailabilities, cageAvailabilities, fieldOverrides, cageOverrides
    );

    await generator.generate();

    const games = generator.getScheduledEvents().filter(e => e.eventType === 'game');

    // Print AA games for comparison with production
    const aaDiv = divisions.find(d => d.name === 'AA');
    if (aaDiv) {
      const aaGames = games.filter(g => g.divisionId === aaDiv.id).sort((a, b) =>
        a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
      );
      console.log('\n=== LOCAL AA Games (for comparison) ===');
      for (const g of aaGames) {
        const home = teams.find(t => t.id === g.homeTeamId)?.name || g.homeTeamId;
        const away = teams.find(t => t.id === g.awayTeamId)?.name || g.awayTeamId;
        console.log(`${g.date} ${home} vs ${away}`);
      }
    }

    console.log('\n=== Game Gap Analysis (Production Data) ===\n');

    // Group by division
    for (const div of divisions) {
      const config = divisionConfigs.find(c => c.divisionId === div.id);
      const divTeams = teams.filter(t => t.divisionId === div.id);
      const divGames = games.filter(g => g.divisionId === div.id);

      if (divGames.length === 0) continue;

      const spacingEnabled = config?.gameSpacingEnabled || false;
      console.log(`${div.name} (gameSpacingEnabled: ${spacingEnabled}):`);
      console.log(`  Total games: ${divGames.length}`);

      // Analyze gaps per team
      const gapCounts = new Map<number, number>(); // gap -> count
      const teamGapDetails = new Map<string, { min: number; gapList: Array<{gap: number, dates: string}> }>();

      for (const team of divTeams) {
        const teamGames = divGames.filter(g => g.homeTeamId === team.id || g.awayTeamId === team.id);
        const dates = [...new Set(teamGames.map(g => g.date))].sort();

        const gapList: Array<{gap: number, dates: string}> = [];
        for (let i = 1; i < dates.length; i++) {
          const d1 = new Date(dates[i-1]);
          const d2 = new Date(dates[i]);
          const gap = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
          gapList.push({ gap, dates: `${dates[i-1]} -> ${dates[i]}` });
          gapCounts.set(gap, (gapCounts.get(gap) || 0) + 1);
        }

        const minGap = gapList.length > 0 ? Math.min(...gapList.map(g => g.gap)) : Infinity;
        teamGapDetails.set(team.name, { min: minGap, gapList });
      }

      // Find overall min gap
      const allGaps = Array.from(gapCounts.keys()).sort((a, b) => a - b);
      const minGap = allGaps.length > 0 ? allGaps[0] : 'N/A';

      console.log(`  Min gap across all teams: ${minGap} days`);

      // Show gap distribution for small gaps
      console.log(`  Gap distribution (1-4 days):`);
      for (let gap = 1; gap <= 4; gap++) {
        const count = gapCounts.get(gap) || 0;
        if (count > 0) {
          console.log(`    ${gap} day(s): ${count} occurrences`);
        }
      }

      // Show specific instances of 1-day and 2-day gaps for game-spacing divisions
      if (spacingEnabled && typeof minGap === 'number' && minGap <= 2) {
        console.log(`  Specific short gaps:`);
        for (const [teamName, data] of teamGapDetails) {
          const shortGaps = data.gapList.filter(g => g.gap <= 2);
          if (shortGaps.length > 0) {
            console.log(`    ${teamName}:`);
            for (const sg of shortGaps) {
              const marker = sg.gap === 1 ? '⚠️ BACK-TO-BACK' : '';
              console.log(`      ${sg.gap} day: ${sg.dates} ${marker}`);
            }
          }
        }
      }

      console.log('');
    }
  });
});
