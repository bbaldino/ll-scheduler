import { describe, it, expect } from 'vitest';
import {
  buildCompetitionGroups,
  initializeRequiredDayBudgetTracker,
  canUseRequiredDaySlot,
  getPreferenceWeight,
  type CompetitionGroup,
} from './generator.js';
import type { Division, DivisionConfig, FieldAvailability, SeasonField } from '@ll-scheduler/shared';

describe('getPreferenceWeight', () => {
  it('returns correct weights for each priority', () => {
    expect(getPreferenceWeight('required')).toBe(3);
    expect(getPreferenceWeight('preferred')).toBe(2);
    expect(getPreferenceWeight('acceptable')).toBe(1);
    expect(getPreferenceWeight('avoid')).toBe(0);
  });
});

describe('buildCompetitionGroups', () => {
  // Helper to create test data with minimal required fields
  const createDivision = (id: string): Division => ({
    id,
    name: `Division ${id}`,
    schedulingOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createDivisionConfig = (
    id: string,
    dayPrefs: Array<{ day: number; priority: 'required' | 'preferred' | 'acceptable' | 'avoid' }>,
    fieldPrefs: string[] = ['field1']
  ): DivisionConfig => ({
    id: `config-${id}`,
    divisionId: id,
    seasonId: 'season1',
    practicesPerWeek: 2,
    practiceDurationHours: 1.5,
    gamesPerWeek: 2,
    gameDurationHours: 1.5,
    gameArriveBeforeHours: 0.5,
    fieldPreferences: fieldPrefs,
    gameDayPreferences: dayPrefs.map((p) => ({
      dayOfWeek: p.day,
      priority: p.priority,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createSeasonField = (id: string, fieldId: string): SeasonField => ({
    id,
    seasonId: 'season1',
    fieldId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createFieldAvailability = (
    seasonFieldId: string,
    dayOfWeek: number,
    start: string = '09:00',
    end: string = '17:00'
  ): FieldAvailability => ({
    id: `avail-${seasonFieldId}-${dayOfWeek}`,
    seasonFieldId,
    dayOfWeek,
    startTime: start,
    endTime: end,
    singleEventOnly: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('creates competition group when two divisions share primary field on same day', () => {
    const divisions = [createDivision('divA'), createDivision('divB')];
    const divisionConfigs = new Map<string, DivisionConfig>([
      ['divA', createDivisionConfig('divA', [{ day: 6, priority: 'required' }], ['field1'])],
      ['divB', createDivisionConfig('divB', [{ day: 6, priority: 'required' }], ['field1'])],
    ]);
    const seasonFields = [createSeasonField('sf1', 'field1')];
    const fieldAvailabilities = [createFieldAvailability('sf1', 6, '09:00', '17:00')]; // Saturday 8 hours

    const groups = buildCompetitionGroups(divisions, divisionConfigs, fieldAvailabilities, seasonFields, 10);

    expect(groups.length).toBe(1);
    expect(groups[0].dayOfWeek).toBe(6); // Saturday
    expect(groups[0].divisionIds).toContain('divA');
    expect(groups[0].divisionIds).toContain('divB');
    expect(groups[0].primaryFieldId).toBe('field1');
  });

  it('calculates slots per week based on availability and game duration', () => {
    const divisions = [createDivision('divA'), createDivision('divB')];
    const divisionConfigs = new Map<string, DivisionConfig>([
      ['divA', createDivisionConfig('divA', [{ day: 6, priority: 'required' }], ['field1'])],
      ['divB', createDivisionConfig('divB', [{ day: 6, priority: 'required' }], ['field1'])],
    ]);
    const seasonFields = [createSeasonField('sf1', 'field1')];
    // 8 hours available, 2 hour game slots (1.5 + 0.5) = 4 games per week
    const fieldAvailabilities = [createFieldAvailability('sf1', 6, '09:00', '17:00')];

    const groups = buildCompetitionGroups(divisions, divisionConfigs, fieldAvailabilities, seasonFields, 10);

    expect(groups[0].slotsPerWeek).toBe(4); // 8 hours / 2 hours per game = 4
  });

  it('includes preference weights for each division', () => {
    const divisions = [createDivision('divA'), createDivision('divB')];
    const divisionConfigs = new Map<string, DivisionConfig>([
      ['divA', createDivisionConfig('divA', [{ day: 6, priority: 'required' }], ['field1'])],
      ['divB', createDivisionConfig('divB', [{ day: 6, priority: 'preferred' }], ['field1'])],
    ]);
    const seasonFields = [createSeasonField('sf1', 'field1')];
    const fieldAvailabilities = [createFieldAvailability('sf1', 6, '09:00', '17:00')];

    const groups = buildCompetitionGroups(divisions, divisionConfigs, fieldAvailabilities, seasonFields, 10);

    expect(groups[0].divisionPreferences.length).toBe(2);

    // Should be sorted by weight descending (required=3 before preferred=2)
    const divAPrefs = groups[0].divisionPreferences.find((p) => p.divisionId === 'divA')!;
    const divBPrefs = groups[0].divisionPreferences.find((p) => p.divisionId === 'divB')!;

    expect(divAPrefs.priority).toBe('required');
    expect(divAPrefs.weight).toBe(3);
    expect(divBPrefs.priority).toBe('preferred');
    expect(divBPrefs.weight).toBe(2);

    // First should be the one with higher weight
    expect(groups[0].divisionPreferences[0].weight).toBeGreaterThanOrEqual(groups[0].divisionPreferences[1].weight);
  });

  it('does not create group for single division on a field', () => {
    const divisions = [createDivision('divA'), createDivision('divB')];
    const divisionConfigs = new Map<string, DivisionConfig>([
      ['divA', createDivisionConfig('divA', [{ day: 6, priority: 'required' }], ['field1'])],
      ['divB', createDivisionConfig('divB', [{ day: 6, priority: 'required' }], ['field2'])], // Different field
    ]);
    const seasonFields = [
      createSeasonField('sf1', 'field1'),
      createSeasonField('sf2', 'field2'),
    ];
    const fieldAvailabilities = [
      createFieldAvailability('sf1', 6),
      createFieldAvailability('sf2', 6),
    ];

    const groups = buildCompetitionGroups(divisions, divisionConfigs, fieldAvailabilities, seasonFields, 10);

    expect(groups.length).toBe(0); // No competition groups since each division has its own field
  });
});

describe('initializeRequiredDayBudgetTracker', () => {
  it('allocates budgets proportionally based on preference weights', () => {
    // Two divisions with different preferences sharing 4 slots
    // divA: required (weight=3), divB: acceptable (weight=1)
    // Total weight = 4, so divA gets 3/4 * 4 = 3 slots, divB gets 1/4 * 4 = 1 slot
    const group: CompetitionGroup = {
      dayOfWeek: 6,
      divisionIds: ['divA', 'divB'],
      primaryFieldId: 'field1',
      slotsPerWeek: 4,
      divisionPreferences: [
        { divisionId: 'divA', priority: 'required', weight: 3 },
        { divisionId: 'divB', priority: 'acceptable', weight: 1 },
      ],
    };

    const divisionNames = new Map([
      ['divA', 'Division A'],
      ['divB', 'Division B'],
    ]);

    const tracker = initializeRequiredDayBudgetTracker([group], divisionNames, 3);

    // Check week 0 budgets
    const divABudget = tracker.budgets.get('divA|6|0');
    const divBBudget = tracker.budgets.get('divB|6|0');

    expect(divABudget).toBe(3); // 3/4 * 4 = 3
    expect(divBBudget).toBe(1); // 1/4 * 4 = 1

    // Total should equal slots per week
    expect(divABudget! + divBBudget!).toBe(4);
  });

  it('allocates equal budgets when both divisions have same preference', () => {
    const group: CompetitionGroup = {
      dayOfWeek: 6,
      divisionIds: ['divA', 'divB'],
      primaryFieldId: 'field1',
      slotsPerWeek: 4,
      divisionPreferences: [
        { divisionId: 'divA', priority: 'required', weight: 3 },
        { divisionId: 'divB', priority: 'required', weight: 3 },
      ],
    };

    const divisionNames = new Map([
      ['divA', 'Division A'],
      ['divB', 'Division B'],
    ]);

    const tracker = initializeRequiredDayBudgetTracker([group], divisionNames, 3);

    const divABudget = tracker.budgets.get('divA|6|0');
    const divBBudget = tracker.budgets.get('divB|6|0');

    expect(divABudget).toBe(2); // 3/6 * 4 = 2
    expect(divBBudget).toBe(2); // 3/6 * 4 = 2
  });

  it('ensures minimum of 1 slot per division', () => {
    // Even with low weight, each division should get at least 1 slot
    const group: CompetitionGroup = {
      dayOfWeek: 6,
      divisionIds: ['divA', 'divB'],
      primaryFieldId: 'field1',
      slotsPerWeek: 2,
      divisionPreferences: [
        { divisionId: 'divA', priority: 'required', weight: 3 },
        { divisionId: 'divB', priority: 'acceptable', weight: 1 },
      ],
    };

    const divisionNames = new Map([
      ['divA', 'Division A'],
      ['divB', 'Division B'],
    ]);

    const tracker = initializeRequiredDayBudgetTracker([group], divisionNames, 3);

    const divBBudget = tracker.budgets.get('divB|6|0');
    expect(divBBudget).toBeGreaterThanOrEqual(1);
  });

  it('creates budgets for each week', () => {
    const group: CompetitionGroup = {
      dayOfWeek: 6,
      divisionIds: ['divA', 'divB'],
      primaryFieldId: 'field1',
      slotsPerWeek: 4,
      divisionPreferences: [
        { divisionId: 'divA', priority: 'required', weight: 3 },
        { divisionId: 'divB', priority: 'required', weight: 3 },
      ],
    };

    const divisionNames = new Map([
      ['divA', 'Division A'],
      ['divB', 'Division B'],
    ]);

    const tracker = initializeRequiredDayBudgetTracker([group], divisionNames, 5);

    // Check all 5 weeks have budgets
    for (let week = 0; week < 5; week++) {
      expect(tracker.budgets.has(`divA|6|${week}`)).toBe(true);
      expect(tracker.budgets.has(`divB|6|${week}`)).toBe(true);
    }
  });
});

describe('canUseRequiredDaySlot', () => {
  it('returns true when budget is available', () => {
    const group: CompetitionGroup = {
      dayOfWeek: 6,
      divisionIds: ['divA', 'divB'],
      primaryFieldId: 'field1',
      slotsPerWeek: 4,
      divisionPreferences: [
        { divisionId: 'divA', priority: 'required', weight: 3 },
        { divisionId: 'divB', priority: 'required', weight: 3 },
      ],
    };

    const tracker = initializeRequiredDayBudgetTracker([group], new Map(), 3);

    expect(canUseRequiredDaySlot('divA', 6, 0, tracker)).toBe(true);
  });

  it('returns false when budget is exhausted', () => {
    const group: CompetitionGroup = {
      dayOfWeek: 6,
      divisionIds: ['divA', 'divB'],
      primaryFieldId: 'field1',
      slotsPerWeek: 2,
      divisionPreferences: [
        { divisionId: 'divA', priority: 'required', weight: 3 },
        { divisionId: 'divB', priority: 'required', weight: 3 },
      ],
    };

    const tracker = initializeRequiredDayBudgetTracker([group], new Map(), 3);

    // Each division gets 1 slot per week
    // Use up the budget
    tracker.usage.set('divA|6|0', 1);

    expect(canUseRequiredDaySlot('divA', 6, 0, tracker)).toBe(false);
  });

  it('returns true for divisions not in any competition group', () => {
    const group: CompetitionGroup = {
      dayOfWeek: 6,
      divisionIds: ['divA', 'divB'],
      primaryFieldId: 'field1',
      slotsPerWeek: 4,
      divisionPreferences: [
        { divisionId: 'divA', priority: 'required', weight: 3 },
        { divisionId: 'divB', priority: 'required', weight: 3 },
      ],
    };

    const tracker = initializeRequiredDayBudgetTracker([group], new Map(), 3);

    // divC is not in any competition group
    expect(canUseRequiredDaySlot('divC', 6, 0, tracker)).toBe(true);
  });

  it('tracks usage per week independently', () => {
    const group: CompetitionGroup = {
      dayOfWeek: 6,
      divisionIds: ['divA', 'divB'],
      primaryFieldId: 'field1',
      slotsPerWeek: 2,
      divisionPreferences: [
        { divisionId: 'divA', priority: 'required', weight: 3 },
        { divisionId: 'divB', priority: 'required', weight: 3 },
      ],
    };

    const tracker = initializeRequiredDayBudgetTracker([group], new Map(), 3);

    // Exhaust week 0 budget
    tracker.usage.set('divA|6|0', 1);

    // Week 0 should be exhausted
    expect(canUseRequiredDaySlot('divA', 6, 0, tracker)).toBe(false);

    // Week 1 should still have budget
    expect(canUseRequiredDaySlot('divA', 6, 1, tracker)).toBe(true);
  });
});

describe('interleaved scheduling primary field distribution', () => {
  it('distributes games on primary field between competing divisions when secondary fields are available', async () => {
    // Import ScheduleGenerator for this test
    const { ScheduleGenerator } = await import('./generator.js');

    // Setup: Two divisions (A and Tball) both prefer 'primaryField' but are also compatible with 'secondaryField'
    const season = {
      id: 'season1',
      name: 'Test Season',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      gamesStartDate: '2026-03-01',
      status: 'draft' as const,
      blackoutDates: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const divisions = [
      { id: 'divA', name: 'A', schedulingOrder: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'divTball', name: 'Tball', schedulingOrder: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];

    // Both divisions prefer primaryField first, then secondaryField
    const divisionConfigs = [
      {
        id: 'config-divA',
        divisionId: 'divA',
        seasonId: 'season1',
        practicesPerWeek: 0,
        practiceDurationHours: 0,
        gamesPerWeek: 2,
        gameDurationHours: 1.5,
        gameArriveBeforeHours: 0.5,
        cageSessionsPerWeek: 0, // No cage sessions
        cageSessionDurationHours: 0,
        fieldPreferences: ['primaryField', 'secondaryField'], // Primary field first
        gameDayPreferences: [{ dayOfWeek: 6, priority: 'required' as const }], // Saturday required
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'config-divTball',
        divisionId: 'divTball',
        seasonId: 'season1',
        practicesPerWeek: 0,
        practiceDurationHours: 0,
        gamesPerWeek: 2,
        gameDurationHours: 1.5,
        gameArriveBeforeHours: 0.5,
        cageSessionsPerWeek: 0, // No cage sessions
        cageSessionDurationHours: 0,
        fieldPreferences: ['primaryField', 'secondaryField'], // Same primary field
        gameDayPreferences: [{ dayOfWeek: 6, priority: 'required' as const }], // Saturday required
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Create 4 teams per division (needed for 2 games per week)
    const teams = [
      { id: 'teamA1', name: 'A Team 1', divisionId: 'divA', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'teamA2', name: 'A Team 2', divisionId: 'divA', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'teamA3', name: 'A Team 3', divisionId: 'divA', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'teamA4', name: 'A Team 4', divisionId: 'divA', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'teamT1', name: 'Tball Team 1', divisionId: 'divTball', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'teamT2', name: 'Tball Team 2', divisionId: 'divTball', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'teamT3', name: 'Tball Team 3', divisionId: 'divTball', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'teamT4', name: 'Tball Team 4', divisionId: 'divTball', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];

    // Season fields - both compatible with both divisions
    const seasonFields = [
      {
        id: 'sf-primary',
        seasonId: 'season1',
        fieldId: 'primaryField',
        fieldName: 'Primary Field',
        divisionCompatibility: [], // Empty = all divisions
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sf-secondary',
        seasonId: 'season1',
        fieldId: 'secondaryField',
        fieldName: 'Secondary Field',
        divisionCompatibility: [], // Empty = all divisions
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Field availability: Both fields available all day Saturday with enough slots for 4 games each
    // 8 hours availability / 2 hour game slots = 4 games per field
    const fieldAvailability = [
      {
        id: 'avail-primary-sat',
        seasonFieldId: 'sf-primary',
        dayOfWeek: 6,
        startTime: '08:00',
        endTime: '16:00', // 8 hours = 4 game slots
        singleEventOnly: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'avail-secondary-sat',
        seasonFieldId: 'sf-secondary',
        dayOfWeek: 6,
        startTime: '08:00',
        endTime: '16:00', // 8 hours = 4 game slots
        singleEventOnly: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Minimal cage setup (required by validator even if not used)
    const seasonCages = [
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

    const cageAvailability = [
      {
        id: 'avail-cage1-sat',
        seasonCageId: 'sc-cage1',
        dayOfWeek: 6,
        startTime: '08:00',
        endTime: '16:00',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Create generator (uses DEFAULT_SCORING_WEIGHTS by default)
    const generator = new ScheduleGenerator(
      season,
      divisions,
      divisionConfigs,
      teams,
      seasonFields,
      seasonCages,
      fieldAvailability,
      cageAvailability,
      [], // No field overrides
      []  // No cage overrides
    );

    // Generate schedule
    const result = await generator.generate();

    // Debug: log any errors if generation failed
    if (!result.success) {
      console.log('Generation failed:', result.message);
      console.log('Errors:', JSON.stringify(result.errors, null, 2));
    }

    expect(result.success).toBe(true);

    // Get scheduled events
    const events = generator.getScheduledEvents();
    const games = events.filter(e => e.eventType === 'game');

    // Get games on the primary field for each division
    const divAGamesOnPrimary = games.filter(g => g.divisionId === 'divA' && g.fieldId === 'primaryField');
    const divTballGamesOnPrimary = games.filter(g => g.divisionId === 'divTball' && g.fieldId === 'primaryField');

    // THE KEY ASSERTION: Both divisions should have games on the primary field
    // Before the fix, one division would get all primary field slots and the other would get none
    expect(divAGamesOnPrimary.length).toBeGreaterThan(0);
    expect(divTballGamesOnPrimary.length).toBeGreaterThan(0);

    // Additional check: the distribution should be roughly equal (within 1-2 games)
    // With 4 total slots on primary field and equal preference weights, each should get ~2
    const diff = Math.abs(divAGamesOnPrimary.length - divTballGamesOnPrimary.length);
    expect(diff).toBeLessThanOrEqual(2);

    // Log for debugging
    console.log(`A games on primary: ${divAGamesOnPrimary.length}`);
    console.log(`Tball games on primary: ${divTballGamesOnPrimary.length}`);
  });
});
