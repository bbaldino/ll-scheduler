import { describe, it, expect } from 'vitest';
import { evaluateConstraintViolations } from './schedule-evaluator.js';
import type {
  ScheduledEvent,
  Team,
  Division,
  DivisionConfig,
  SeasonField,
  SeasonCage,
  Season,
} from '@ll-scheduler/shared';

// Helper to create a minimal team
function createTeam(id: string, name: string, divisionId: string): Team {
  return {
    id,
    name,
    divisionId,
    seasonId: 'season-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

// Helper to create a minimal division
function createDivision(id: string, name: string): Division {
  return {
    id,
    name,
    schedulingOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

// Helper to create a minimal division config
function createDivisionConfig(divisionId: string): DivisionConfig {
  return {
    id: `config-${divisionId}`,
    divisionId,
    seasonId: 'season-1',
    gamesPerWeek: 2,
    practicesPerWeek: 1,
    gameDurationHours: 2,
    practiceDurationHours: 1.5,
    gameArriveBeforeHours: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

// Helper to create a minimal season
function createSeason(): Season {
  return {
    id: 'season-1',
    name: 'Test Season',
    startDate: '2024-03-01',
    endDate: '2024-06-01',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

// Helper to create a game event
function createGame(
  id: string,
  date: string,
  startTime: string,
  endTime: string,
  homeTeamId: string,
  awayTeamId: string,
  fieldId: string,
  divisionId: string
): ScheduledEvent {
  return {
    id,
    seasonId: 'season-1',
    divisionId,
    eventType: 'game',
    date,
    startTime,
    endTime,
    status: 'scheduled',
    homeTeamId,
    awayTeamId,
    fieldId,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

// Helper to create a practice event
function createPractice(
  id: string,
  date: string,
  startTime: string,
  endTime: string,
  teamId: string,
  fieldId: string,
  divisionId: string
): ScheduledEvent {
  return {
    id,
    seasonId: 'season-1',
    divisionId,
    eventType: 'practice',
    date,
    startTime,
    endTime,
    status: 'scheduled',
    teamId,
    fieldId,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

// Helper to create a cage event
function createCage(
  id: string,
  date: string,
  startTime: string,
  endTime: string,
  teamId: string,
  cageId: string,
  divisionId: string
): ScheduledEvent {
  return {
    id,
    seasonId: 'season-1',
    divisionId,
    eventType: 'cage',
    date,
    startTime,
    endTime,
    status: 'scheduled',
    teamId,
    cageId,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('evaluateConstraintViolations', () => {
  // Common test setup
  const team1 = createTeam('team-1', 'Red Sox', 'div-1');
  const team2 = createTeam('team-2', 'Yankees', 'div-1');
  const division = createDivision('div-1', 'Majors');
  const config = createDivisionConfig('div-1');
  const season = createSeason();

  const teamMap = new Map<string, Team>([[team1.id, team1], [team2.id, team2]]);
  const divisionMap = new Map<string, Division>([[division.id, division]]);
  const configByDivision = new Map<string, DivisionConfig>([[division.id, config]]);
  const fieldMap = new Map<string, SeasonField>();
  const cageMap = new Map<string, SeasonCage>();

  describe('same_day_conflict detection', () => {
    it('should flag two games for the same team on the same day', () => {
      const events: ScheduledEvent[] = [
        createGame('game-1', '2024-03-15', '09:00', '11:00', 'team-1', 'team-2', 'field-1', 'div-1'),
        createGame('game-2', '2024-03-15', '14:00', '16:00', 'team-1', 'team-2', 'field-2', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter((v) => v.type === 'same_day_conflict');
      expect(sameDayViolations.length).toBeGreaterThan(0);
      // Both teams (team-1 and team-2) should have violations since they're both in 2 games
      expect(sameDayViolations.some((v) => v.teamId === 'team-1')).toBe(true);
    });

    it('should flag a game and practice for the same team on the same day', () => {
      const events: ScheduledEvent[] = [
        createGame('game-1', '2024-03-15', '09:00', '11:00', 'team-1', 'team-2', 'field-1', 'div-1'),
        createPractice('practice-1', '2024-03-15', '14:00', '15:30', 'team-1', 'field-2', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter(
        (v) => v.type === 'same_day_conflict' && v.teamId === 'team-1'
      );
      expect(sameDayViolations.length).toBe(1);
      expect(sameDayViolations[0].description).toContain('2 field events');
    });

    it('should flag two practices for the same team on the same day', () => {
      const events: ScheduledEvent[] = [
        createPractice('practice-1', '2024-03-15', '09:00', '10:30', 'team-1', 'field-1', 'div-1'),
        createPractice('practice-2', '2024-03-15', '14:00', '15:30', 'team-1', 'field-2', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter(
        (v) => v.type === 'same_day_conflict' && v.teamId === 'team-1'
      );
      expect(sameDayViolations.length).toBe(1);
      expect(sameDayViolations[0].description).toContain('2 field events');
    });

    it('should flag a game and cage for the same team on the same day', () => {
      const events: ScheduledEvent[] = [
        createGame('game-1', '2024-03-15', '09:00', '11:00', 'team-1', 'team-2', 'field-1', 'div-1'),
        createCage('cage-1', '2024-03-15', '14:00', '15:00', 'team-1', 'cage-1', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter(
        (v) => v.type === 'same_day_conflict' && v.teamId === 'team-1'
      );
      expect(sameDayViolations.length).toBe(1);
    });

    it('should NOT flag a practice and cage for the same team on the same day', () => {
      const events: ScheduledEvent[] = [
        createPractice('practice-1', '2024-03-15', '09:00', '10:30', 'team-1', 'field-1', 'div-1'),
        createCage('cage-1', '2024-03-15', '14:00', '15:00', 'team-1', 'cage-1', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter(
        (v) => v.type === 'same_day_conflict' && v.teamId === 'team-1'
      );
      expect(sameDayViolations.length).toBe(0);
    });

    it('should flag two cages for the same team on the same day', () => {
      const events: ScheduledEvent[] = [
        createCage('cage-1', '2024-03-15', '09:00', '10:00', 'team-1', 'cage-1', 'div-1'),
        createCage('cage-2', '2024-03-15', '14:00', '15:00', 'team-1', 'cage-2', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter(
        (v) => v.type === 'same_day_conflict' && v.teamId === 'team-1'
      );
      expect(sameDayViolations.length).toBe(1);
    });

    it('should NOT flag events for different teams on the same day', () => {
      const events: ScheduledEvent[] = [
        createPractice('practice-1', '2024-03-15', '09:00', '10:30', 'team-1', 'field-1', 'div-1'),
        createPractice('practice-2', '2024-03-15', '14:00', '15:30', 'team-2', 'field-2', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter((v) => v.type === 'same_day_conflict');
      expect(sameDayViolations.length).toBe(0);
    });

    it('should flag three field events for the same team on the same day', () => {
      const events: ScheduledEvent[] = [
        createGame('game-1', '2024-03-15', '09:00', '11:00', 'team-1', 'team-2', 'field-1', 'div-1'),
        createPractice('practice-1', '2024-03-15', '12:00', '13:30', 'team-1', 'field-2', 'div-1'),
        createGame('game-2', '2024-03-15', '15:00', '17:00', 'team-1', 'team-2', 'field-3', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter(
        (v) => v.type === 'same_day_conflict' && v.teamId === 'team-1'
      );
      expect(sameDayViolations.length).toBe(1);
      expect(sameDayViolations[0].description).toContain('3 field events');
    });
  });

  describe('time overlap detection', () => {
    it('should flag overlapping events on the same resource as resource_conflict', () => {
      const events: ScheduledEvent[] = [
        createGame('game-1', '2024-03-15', '09:00', '11:00', 'team-1', 'team-2', 'field-1', 'div-1'),
        createPractice('practice-1', '2024-03-15', '10:00', '11:30', 'team-2', 'field-1', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const resourceConflicts = result.violations.filter((v) => v.type === 'resource_conflict');
      expect(resourceConflicts.length).toBe(1);
      expect(resourceConflicts[0].severity).toBe('error');
    });

    it('should flag when same team has overlapping events on different fields', () => {
      // Team 1 has a game 9-11am on field-1 and a practice 10-11:30am on field-2
      // These overlap in time even though they're on different fields
      const events: ScheduledEvent[] = [
        createGame('game-1', '2024-03-15', '09:00', '11:00', 'team-1', 'team-2', 'field-1', 'div-1'),
        createPractice('practice-1', '2024-03-15', '10:00', '11:30', 'team-1', 'field-2', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      // Currently this would be flagged as same_day_conflict (2 field events)
      // but should ideally be flagged as a more severe team_time_conflict
      const violations = result.violations.filter(
        (v) => v.teamId === 'team-1' && (v.type === 'same_day_conflict' || v.type === 'team_time_conflict')
      );
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should flag team with game and cage at overlapping times', () => {
      // Team 1 has a game 9-11am and a cage session 10-11am
      // Game + cage on same day should be flagged regardless of overlap
      const events: ScheduledEvent[] = [
        createGame('game-1', '2024-03-15', '09:00', '11:00', 'team-1', 'team-2', 'field-1', 'div-1'),
        createCage('cage-1', '2024-03-15', '10:00', '11:00', 'team-1', 'cage-1', 'div-1'),
      ];

      const result = evaluateConstraintViolations(
        events,
        teamMap,
        divisionMap,
        configByDivision,
        fieldMap,
        cageMap,
        season
      );

      const sameDayViolations = result.violations.filter(
        (v) => v.type === 'same_day_conflict' && v.teamId === 'team-1'
      );
      expect(sameDayViolations.length).toBe(1);
    });
  });
});
