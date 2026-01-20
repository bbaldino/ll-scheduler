import { describe, it, expect } from 'vitest';
import { ScheduleGenerator } from './generator.js';
import type { Season, Division, DivisionConfig, Team, SeasonField, SeasonCage, FieldAvailability, CageAvailability } from '@ll-scheduler/shared';

/**
 * Test Saturday game fairness within divisions that share a primary field.
 *
 * The scenario: TBall and A divisions both prefer the same primary field on Saturday.
 * Within each division, Saturday games should be distributed fairly among all teams.
 */
describe('Saturday game fairness within divisions', () => {
  // Helper to create a season spanning multiple weeks
  const createSeason = (weeks: number): Season => {
    const startDate = new Date('2026-03-01');
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + weeks * 7);

    return {
      id: 'season1',
      name: 'Test Season',
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      gamesStartDate: startDate.toISOString().split('T')[0],
      status: 'draft' as const,
      blackoutDates: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const createDivision = (id: string, name: string, order: number): Division => ({
    id,
    name,
    schedulingOrder: order,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createDivisionConfig = (
    divisionId: string,
    gamesPerWeek: number,
    fieldPreferences: string[]
  ): DivisionConfig => ({
    id: `config-${divisionId}`,
    divisionId,
    seasonId: 'season1',
    practicesPerWeek: 0,
    practiceDurationHours: 0,
    gamesPerWeek,
    gameDurationHours: 1.5,
    gameArriveBeforeHours: 0.5,
    cageSessionsPerWeek: 0,
    cageSessionDurationHours: 0,
    fieldPreferences,
    gameDayPreferences: [
      { dayOfWeek: 6, priority: 'required' as const }, // Saturday required
      { dayOfWeek: 1, priority: 'acceptable' as const }, // Monday acceptable
      { dayOfWeek: 2, priority: 'acceptable' as const }, // Tuesday acceptable
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createTeam = (id: string, name: string, divisionId: string): Team => ({
    id,
    name,
    divisionId,
    seasonId: 'season1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createSeasonField = (id: string, fieldId: string, fieldName: string): SeasonField => ({
    id,
    seasonId: 'season1',
    fieldId,
    fieldName,
    divisionCompatibility: [], // All divisions
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createFieldAvailability = (
    seasonFieldId: string,
    dayOfWeek: number,
    startTime: string,
    endTime: string
  ): FieldAvailability => ({
    id: `avail-${seasonFieldId}-${dayOfWeek}`,
    seasonFieldId,
    dayOfWeek,
    startTime,
    endTime,
    singleEventOnly: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('distributes Saturday games fairly among teams within each division', async () => {
    const numWeeks = 12; // Real season length
    const season = createSeason(numWeeks);

    // Add blackout dates for some Saturdays to match real scenario
    // Weeks 7, 9, and 12 have no Saturday availability in the real app
    // Start date is 2026-03-01 (Sunday), so week 1 Saturday = 2026-03-07
    season.blackoutDates = [
      { date: '2026-04-11', reason: 'Week 7 blackout' },
      { date: '2026-04-25', reason: 'Week 9 blackout' },
      { date: '2026-05-16', reason: 'Week 12 blackout' },
    ];

    // Two divisions sharing primary field (TBall first in scheduling order)
    const divisions = [
      createDivision('divTball', 'Tball', 1),
      createDivision('divA', 'A', 2),
    ];

    // Match real config: TBall 3 games/week, A 6 games/week
    // Both prefer tballField first, then aaField
    const divisionConfigs = [
      createDivisionConfig('divTball', 3, ['tballField', 'aaField']),
      createDivisionConfig('divA', 6, ['tballField', 'aaField']),
    ];

    // 6 teams per division (matches real app)
    const teams: Team[] = [
      // TBall teams
      createTeam('tball1', 'TBall Team 1', 'divTball'),
      createTeam('tball2', 'TBall Team 2', 'divTball'),
      createTeam('tball3', 'TBall Team 3', 'divTball'),
      createTeam('tball4', 'TBall Team 4', 'divTball'),
      createTeam('tball5', 'TBall Team 5', 'divTball'),
      createTeam('tball6', 'TBall Team 6', 'divTball'),
      // A teams
      createTeam('a1', 'A Team 1', 'divA'),
      createTeam('a2', 'A Team 2', 'divA'),
      createTeam('a3', 'A Team 3', 'divA'),
      createTeam('a4', 'A Team 4', 'divA'),
      createTeam('a5', 'A Team 5', 'divA'),
      createTeam('a6', 'A Team 6', 'divA'),
    ];

    // Two fields available on Saturday - sized to give ~5 slots total
    // TBall field: 1.5hr games, 8 hours = ~5 slots but shared
    // AA field: 1.5hr games, 8 hours = ~5 slots but shared
    // Real app: 5 slots/week total, A gets 3, TBall gets 2
    const seasonFields: SeasonField[] = [
      createSeasonField('sf-tball', 'tballField', 'Steindorf Tball Field'),
      createSeasonField('sf-aa', 'aaField', 'Steindorf AA Field'),
    ];

    // Real app has 5 slots/week on Saturday (from logs)
    // With 2hr per slot (1.5hr game + 0.5hr arrive), that's 10 hours
    // Also add weekday availability
    const fieldAvailability: FieldAvailability[] = [
      // Saturday
      createFieldAvailability('sf-tball', 6, '08:00', '18:00'), // 10 hours = 5 slots
      createFieldAvailability('sf-aa', 6, '08:00', '18:00'),
      // Monday
      createFieldAvailability('sf-tball', 1, '17:00', '21:00'), // 4 hours = 2 slots
      createFieldAvailability('sf-aa', 1, '17:00', '21:00'),
      // Tuesday
      createFieldAvailability('sf-tball', 2, '17:00', '21:00'),
      createFieldAvailability('sf-aa', 2, '17:00', '21:00'),
    ];

    // Minimal cage setup
    const seasonCages: SeasonCage[] = [
      {
        id: 'sc-cage1',
        seasonId: 'season1',
        cageId: 'cage1',
        cageName: 'Cage 1',
        divisionCompatibility: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const cageAvailability: CageAvailability[] = [
      {
        id: 'avail-cage1-sat',
        seasonCageId: 'sc-cage1',
        dayOfWeek: 6,
        startTime: '08:00',
        endTime: '16:00',
        singleEventOnly: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const generator = new ScheduleGenerator(
      season,
      divisions,
      divisionConfigs,
      teams,
      seasonFields,
      seasonCages,
      fieldAvailability,
      cageAvailability,
      [],
      []
    );

    const result = await generator.generate();

    if (!result.success) {
      console.log('Generation failed:', result.message);
      console.log('Errors:', JSON.stringify(result.errors, null, 2));
    }

    expect(result.success).toBe(true);

    const events = generator.getScheduledEvents();
    const games = events.filter(e => e.eventType === 'game');

    // Count Saturday games per team
    const saturdayGamesPerTeam = new Map<string, number>();
    for (const team of teams) {
      saturdayGamesPerTeam.set(team.id, 0);
    }

    for (const game of games) {
      // Parse date as local date (YYYY-MM-DD format)
      const [year, month, day] = game.date.split('-').map(Number);
      const gameDate = new Date(year, month - 1, day); // month is 0-indexed
      const dayOfWeek = gameDate.getDay();
      if (dayOfWeek === 6) { // Saturday
        if (game.homeTeamId) {
          saturdayGamesPerTeam.set(game.homeTeamId, (saturdayGamesPerTeam.get(game.homeTeamId) || 0) + 1);
        }
        if (game.awayTeamId) {
          saturdayGamesPerTeam.set(game.awayTeamId, (saturdayGamesPerTeam.get(game.awayTeamId) || 0) + 1);
        }
      }
    }

    // Log the distribution
    console.log('\n=== Saturday Game Distribution ===');

    // TBall division
    const tballTeamIds = teams.filter(t => t.divisionId === 'divTball').map(t => t.id);
    const tballSaturdayCounts = tballTeamIds.map(id => saturdayGamesPerTeam.get(id) || 0);
    console.log('\nTBall:');
    for (const team of teams.filter(t => t.divisionId === 'divTball')) {
      console.log(`  ${team.name}: ${saturdayGamesPerTeam.get(team.id)} Saturday games`);
    }
    const tballMin = Math.min(...tballSaturdayCounts);
    const tballMax = Math.max(...tballSaturdayCounts);
    const tballSpread = tballMax - tballMin;
    console.log(`  Spread: ${tballMin} - ${tballMax} (diff: ${tballSpread})`);

    // A division
    const aTeamIds = teams.filter(t => t.divisionId === 'divA').map(t => t.id);
    const aSaturdayCounts = aTeamIds.map(id => saturdayGamesPerTeam.get(id) || 0);
    console.log('\nA Division:');
    for (const team of teams.filter(t => t.divisionId === 'divA')) {
      console.log(`  ${team.name}: ${saturdayGamesPerTeam.get(team.id)} Saturday games`);
    }
    const aMin = Math.min(...aSaturdayCounts);
    const aMax = Math.max(...aSaturdayCounts);
    const aSpread = aMax - aMin;
    console.log(`  Spread: ${aMin} - ${aMax} (diff: ${aSpread})`);

    // ASSERTIONS: The spread within each division should be at most 2
    // The fairness algorithm sorts matchups by MIN Saturday games to prioritize teams that are behind
    expect(tballSpread).toBeLessThanOrEqual(2);
    expect(aSpread).toBeLessThanOrEqual(2);
  });
});
