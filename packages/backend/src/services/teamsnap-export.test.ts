import { describe, it, expect } from 'vitest';
import {
  formatTimeForTeamSnap,
  formatDateForTeamSnap,
  calculateActualStartTime,
  getArrivalTime,
  getShortLabel,
  getTeamSnapEventType,
} from './teamsnap-export.js';
import type { DivisionConfig } from '@ll-scheduler/shared';

describe('TeamSnap Export', () => {
  describe('formatTimeForTeamSnap', () => {
    it('converts morning time correctly', () => {
      expect(formatTimeForTeamSnap('09:30')).toBe('9:30:00 AM');
    });

    it('converts noon correctly', () => {
      expect(formatTimeForTeamSnap('12:00')).toBe('12:00:00 PM');
    });

    it('converts afternoon time correctly', () => {
      expect(formatTimeForTeamSnap('16:30')).toBe('4:30:00 PM');
    });

    it('converts evening time correctly', () => {
      expect(formatTimeForTeamSnap('19:00')).toBe('7:00:00 PM');
    });

    it('converts midnight correctly', () => {
      expect(formatTimeForTeamSnap('00:00')).toBe('12:00:00 AM');
    });
  });

  describe('formatDateForTeamSnap', () => {
    it('converts date with leading zeros removed', () => {
      expect(formatDateForTeamSnap('2026-03-05')).toBe('3/5/2026');
    });

    it('converts date with double-digit month/day', () => {
      expect(formatDateForTeamSnap('2026-12-15')).toBe('12/15/2026');
    });
  });

  describe('getArrivalTime', () => {
    const createDivisionConfig = (overrides: Partial<DivisionConfig> = {}): DivisionConfig => ({
      id: 'config1',
      divisionId: 'div1',
      seasonId: 'season1',
      practicesPerWeek: 2,
      practiceDurationHours: 1.5,
      gamesPerWeek: 2,
      gameDurationHours: 2,
      cageSessionsPerWeek: 1,
      cageSessionDurationHours: 0.5,
      gameArriveBeforeHours: 1,
      practiceArriveBeforeMinutes: 10,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    });

    it('returns game arrival time in minutes (from hours)', () => {
      const config = createDivisionConfig({ gameArriveBeforeHours: 1 });
      expect(getArrivalTime('game', config)).toBe(60);
    });

    it('returns game arrival time with fractional hours', () => {
      const config = createDivisionConfig({ gameArriveBeforeHours: 0.5 });
      expect(getArrivalTime('game', config)).toBe(30);
    });

    it('returns practice arrival time in minutes', () => {
      const config = createDivisionConfig({ practiceArriveBeforeMinutes: 10 });
      expect(getArrivalTime('practice', config)).toBe(10);
    });

    it('returns cage arrival time (uses practice config)', () => {
      const config = createDivisionConfig({ practiceArriveBeforeMinutes: 15 });
      expect(getArrivalTime('cage', config)).toBe(15);
    });

    it('uses default values when config is undefined', () => {
      expect(getArrivalTime('game', undefined)).toBe(60); // 1 hour default
      expect(getArrivalTime('practice', undefined)).toBe(10); // 10 min default
    });
  });

  describe('getShortLabel', () => {
    it('returns empty string for games', () => {
      expect(getShortLabel('game')).toBe('');
    });

    it('returns "Field Practice" for practices', () => {
      expect(getShortLabel('practice')).toBe('Field Practice');
    });

    it('returns "Batting Cages" for cages', () => {
      expect(getShortLabel('cage')).toBe('Batting Cages');
    });
  });

  describe('getTeamSnapEventType', () => {
    it('returns "Game" for games', () => {
      expect(getTeamSnapEventType('game')).toBe('Game');
    });

    it('returns "Practice" for practices', () => {
      expect(getTeamSnapEventType('practice')).toBe('Practice');
    });

    it('returns "Practice" for cages', () => {
      expect(getTeamSnapEventType('cage')).toBe('Practice');
    });
  });

  describe('TeamSnap Export - Expected Behavior', () => {
    /**
     * These tests document the correct behavior based on how the data model works:
     *
     * GAMES:
     * - event.startTime = slot/arrival time (when teams should arrive for warmup)
     * - The actual game starts after warmup (event.startTime + gameArriveBeforeHours)
     * - Export should show the actual game start time
     *
     * PRACTICES/CAGES:
     * - event.startTime = actual event start time
     * - Export should show this directly (no adjustment needed)
     */

    it('practice: event.startTime=16:30 should export startTime=4:30 PM (no adjustment)', () => {
      // Practices store actual start time, export directly
      const eventStartTime = '16:30';
      const exportedStartTime = formatTimeForTeamSnap(eventStartTime);
      expect(exportedStartTime).toBe('4:30:00 PM');
    });

    it('game: event.startTime=09:00 with 60min arrive-before should export startTime=10:00 AM', () => {
      // Games store arrival time (09:00), need to add arrive-before (60min) to get actual game start
      // 09:00 + 60min = 10:00 AM
      const eventStartTime = '09:00';
      const arrivalMinutes = 60;
      const actualGameStart = calculateActualStartTime(eventStartTime, arrivalMinutes);
      const exportedStartTime = formatTimeForTeamSnap(actualGameStart);
      expect(exportedStartTime).toBe('10:00:00 AM');
    });

    it('cage: event.startTime=17:00 should export startTime=5:00 PM (no adjustment)', () => {
      // Cages store actual start time, export directly
      const eventStartTime = '17:00';
      const exportedStartTime = formatTimeForTeamSnap(eventStartTime);
      expect(exportedStartTime).toBe('5:00:00 PM');
    });
  });
});
