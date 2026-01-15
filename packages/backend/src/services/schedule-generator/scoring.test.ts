import { describe, it, expect } from 'vitest';
import { calculateBackToBackPracticeBalanceRaw, calculatePracticeSpacingRaw } from './scoring.js';
import type { TeamSchedulingState, ScoringWeights, DEFAULT_SCORING_WEIGHTS } from '@ll-scheduler/shared';
import type { ScoringContext } from './scoring.js';

// Helper to create a minimal team state for testing
function createTeamState(overrides: Partial<TeamSchedulingState> = {}): TeamSchedulingState {
  return {
    teamId: 'team1',
    teamName: 'Team 1',
    divisionId: 'div1',
    divisionName: 'Division 1',
    totalGamesNeeded: 10,
    totalPracticesNeeded: 20,
    totalCagesNeeded: 10,
    gamesScheduled: 0,
    practicesScheduled: 0,
    cagesScheduled: 0,
    eventsPerWeek: new Map(),
    dayOfWeekUsage: new Map(),
    homeGames: 0,
    awayGames: 0,
    matchupHomeAway: new Map(),
    fieldDatesUsed: new Set(),
    cageDatesUsed: new Set(),
    minDaysBetweenEvents: 1,
    gameDates: [],
    shortRestGamesCount: 0,
    backToBackPracticesCount: 0,
    ...overrides,
  };
}

// Helper to create a minimal scoring context
function createScoringContext(teamStates: TeamSchedulingState[]): ScoringContext {
  const teamStatesMap = new Map<string, TeamSchedulingState>();
  for (const ts of teamStates) {
    teamStatesMap.set(ts.teamId, ts);
  }
  return {
    teamStates: teamStatesMap,
    resourceUsage: new Map(),
    resourceCapacity: new Map(),
    gameDayPreferences: new Map(),
    fieldPreferences: new Map(),
    weekDefinitions: [],
    scheduledEvents: [],
    divisionConfigs: new Map(),
  };
}

describe('calculatePracticeSpacingRaw', () => {
  it('returns 1.0 for first practice (no existing practices)', () => {
    const teamState = createTeamState({ fieldDatesUsed: new Set(), gameDates: [] });
    const score = calculatePracticeSpacingRaw('2024-03-15', teamState);
    expect(score).toBe(1.0);
  });

  it('returns 1.0 for well-spaced practice (2+ days from nearest)', () => {
    const teamState = createTeamState({
      fieldDatesUsed: new Set(['2024-03-10']), // 5 days before
      gameDates: [],
    });
    const score = calculatePracticeSpacingRaw('2024-03-15', teamState);
    expect(score).toBe(1.0);
  });

  it('returns 0.3 for back-to-back practice (1 day from nearest)', () => {
    const teamState = createTeamState({
      fieldDatesUsed: new Set(['2024-03-14']), // 1 day before
      gameDates: [],
    });
    const score = calculatePracticeSpacingRaw('2024-03-15', teamState);
    expect(score).toBe(0.3);
  });

  it('returns 0.0 for same-day practice', () => {
    const teamState = createTeamState({
      fieldDatesUsed: new Set(['2024-03-15']), // same day
      gameDates: [],
    });
    const score = calculatePracticeSpacingRaw('2024-03-15', teamState);
    expect(score).toBe(0.0);
  });

  it('excludes game dates from practice spacing calculation', () => {
    const teamState = createTeamState({
      fieldDatesUsed: new Set(['2024-03-14']), // 1 day before, but it's a game
      gameDates: ['2024-03-14'],
    });
    // Should be treated as first practice since the only date is a game
    const score = calculatePracticeSpacingRaw('2024-03-15', teamState);
    expect(score).toBe(1.0);
  });
});

describe('calculateBackToBackPracticeBalanceRaw', () => {
  describe('when NOT a back-to-back situation', () => {
    it('returns 0 when no existing practices', () => {
      const teamState = createTeamState({ fieldDatesUsed: new Set(), gameDates: [] });
      const context = createScoringContext([teamState]);
      const score = calculateBackToBackPracticeBalanceRaw('2024-03-15', teamState, context);
      expect(score).toBe(0);
    });

    it('returns 0 when practice is well-spaced (2+ days)', () => {
      const teamState = createTeamState({
        fieldDatesUsed: new Set(['2024-03-10']),
        gameDates: [],
        backToBackPracticesCount: 2,
      });
      const context = createScoringContext([teamState]);
      const score = calculateBackToBackPracticeBalanceRaw('2024-03-15', teamState, context);
      expect(score).toBe(0);
    });
  });

  describe('when IS a back-to-back situation', () => {
    it('returns penalty for team above division average', () => {
      // Team 1 has 3 back-to-backs, Team 2 has 1 -> avg = 2
      const team1 = createTeamState({
        teamId: 'team1',
        fieldDatesUsed: new Set(['2024-03-14']),
        gameDates: [],
        backToBackPracticesCount: 3,
      });
      const team2 = createTeamState({
        teamId: 'team2',
        backToBackPracticesCount: 1,
      });
      const context = createScoringContext([team1, team2]);

      // Team 1 is 1 above average (3 - 2 = 1)
      const score = calculateBackToBackPracticeBalanceRaw('2024-03-15', team1, context);
      expect(score).toBeGreaterThan(0); // Positive = penalty
      expect(score).toBeLessThanOrEqual(1);
    });

    it('returns 0 for team below division average', () => {
      // Team 1 has 0 back-to-backs, Team 2 has 4 -> avg = 2
      const team1 = createTeamState({
        teamId: 'team1',
        fieldDatesUsed: new Set(['2024-03-14']),
        gameDates: [],
        backToBackPracticesCount: 0,
      });
      const team2 = createTeamState({
        teamId: 'team2',
        backToBackPracticesCount: 4,
      });
      const context = createScoringContext([team1, team2]);

      // Team 1 is 2 below average (0 - 2 = -2), should return 0 or negative
      const score = calculateBackToBackPracticeBalanceRaw('2024-03-15', team1, context);
      expect(score).toBeLessThanOrEqual(0);
    });
  });
});

describe('back-to-back practice balance distribution simulation', () => {
  /**
   * Idealized simulation: teams compete simultaneously for back-to-back slots
   */
  it('distributes back-to-backs evenly when teams compete simultaneously', () => {
    const weights = {
      practiceSpacing: 500,
      backToBackPracticeBalance: -800,
    };

    const teamNames = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'];
    const teams: TeamSchedulingState[] = teamNames.map((name, i) =>
      createTeamState({
        teamId: `team${i + 1}`,
        teamName: name,
        backToBackPracticesCount: 0,
      })
    );

    console.log('\n=== Idealized Simulation (Simultaneous Competition) ===\n');

    for (let week = 0; week < 10; week++) {
      const context = createScoringContext(teams);

      // Calculate which team would take the back-to-back slot
      // Team with highest score for btb slot (most willing) takes it
      const btbScores = teams.map(team => {
        const tempTeam = { ...team, fieldDatesUsed: new Set(['2024-03-10']) };
        const rawScore = calculateBackToBackPracticeBalanceRaw('2024-03-11', tempTeam, context);
        const spacingScore = 0.3 * weights.practiceSpacing;
        const balanceScore = rawScore * weights.backToBackPracticeBalance;
        return { team, totalScore: spacingScore + balanceScore };
      });

      btbScores.sort((a, b) => b.totalScore - a.totalScore);
      const teamTakingBtb = btbScores[0].team;
      teamTakingBtb.backToBackPracticesCount++;

      console.log(`Week ${week + 1}: ${teamTakingBtb.teamName} takes btb (now has ${teamTakingBtb.backToBackPracticesCount})`);
    }

    const counts = teams.map(t => t.backToBackPracticesCount).sort((a, b) => b - a);
    console.log('\nFinal distribution:', counts);

    expect(counts.reduce((s, c) => s + c, 0)).toBe(10);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  /**
   * Realistic simulation: teams pick in order, last team may get stuck with btb
   * This mimics the actual scheduling behavior
   */
  it('distributes back-to-backs when teams pick sequentially (with btb sort)', () => {
    const weights = {
      practiceSpacing: 500,
      backToBackPracticeBalance: -800,
    };

    const teamNames = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'];
    const teams: TeamSchedulingState[] = teamNames.map((name, i) =>
      createTeamState({
        teamId: `team${i + 1}`,
        teamName: name,
        backToBackPracticesCount: 0,
      })
    );

    console.log('\n=== Realistic Simulation (With BTB Sort) ===\n');

    for (let week = 0; week < 10; week++) {
      // Sort by back-to-back count (descending) then name
      const sortedTeams = [...teams].sort((a, b) => {
        if (a.backToBackPracticesCount !== b.backToBackPracticesCount) {
          return b.backToBackPracticesCount - a.backToBackPracticesCount;
        }
        return a.teamName.localeCompare(b.teamName);
      });

      // Rotate by week number
      const offset = week % sortedTeams.length;
      const rotatedTeams = [...sortedTeams.slice(offset), ...sortedTeams.slice(0, offset)];

      const context = createScoringContext(teams);
      let slotsAvailable = 5;
      let btbTaken = false;

      for (const team of rotatedTeams) {
        if (slotsAvailable > 0) {
          const tempTeam = { ...team, fieldDatesUsed: new Set(['2024-03-10']) };
          const rawScore = calculateBackToBackPracticeBalanceRaw('2024-03-11', tempTeam, context);
          const btbScore = 0.3 * weights.practiceSpacing + rawScore * weights.backToBackPracticeBalance;
          const nonBtbScore = 1.0 * weights.practiceSpacing;

          if (btbScore > nonBtbScore && !btbTaken) {
            team.backToBackPracticesCount++;
            btbTaken = true;
            console.log(`Week ${week + 1}: ${team.teamName} CHOOSES btb`);
          } else {
            slotsAvailable--;
          }
        } else if (!btbTaken) {
          team.backToBackPracticesCount++;
          btbTaken = true;
          console.log(`Week ${week + 1}: ${team.teamName} FORCED to take btb`);
        }
      }
    }

    const counts = teams.map(t => t.backToBackPracticesCount).sort((a, b) => b - a);
    console.log('\nFinal distribution:', counts, 'Range:', Math.max(...counts) - Math.min(...counts));

    expect(counts.reduce((s, c) => s + c, 0)).toBe(10);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(3);
  });

  /**
   * Alternative: sort by FEWER btb first (teams with fewer btb pick first)
   * This forces below-average teams to take btb early, giving high-btb teams good slots
   */
  it('distributes back-to-backs when sorting by FEWER btb first', () => {
    const weights = {
      practiceSpacing: 500,
      backToBackPracticeBalance: -800,
    };

    const teamNames = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'];
    const teams: TeamSchedulingState[] = teamNames.map((name, i) =>
      createTeamState({
        teamId: `team${i + 1}`,
        teamName: name,
        backToBackPracticesCount: 0,
      })
    );

    console.log('\n=== Simulation (FEWER BTB First) ===\n');

    for (let week = 0; week < 10; week++) {
      // Sort by back-to-back count (ASCENDING) then name - fewer first
      const sortedTeams = [...teams].sort((a, b) => {
        if (a.backToBackPracticesCount !== b.backToBackPracticesCount) {
          return a.backToBackPracticesCount - b.backToBackPracticesCount; // ASCENDING
        }
        return a.teamName.localeCompare(b.teamName);
      });

      const offset = week % sortedTeams.length;
      const rotatedTeams = [...sortedTeams.slice(offset), ...sortedTeams.slice(0, offset)];

      const context = createScoringContext(teams);
      let slotsAvailable = 5;
      let btbTaken = false;

      for (const team of rotatedTeams) {
        if (slotsAvailable > 0) {
          const tempTeam = { ...team, fieldDatesUsed: new Set(['2024-03-10']) };
          const rawScore = calculateBackToBackPracticeBalanceRaw('2024-03-11', tempTeam, context);
          const btbScore = 0.3 * weights.practiceSpacing + rawScore * weights.backToBackPracticeBalance;
          const nonBtbScore = 1.0 * weights.practiceSpacing;

          if (btbScore > nonBtbScore && !btbTaken) {
            team.backToBackPracticesCount++;
            btbTaken = true;
            console.log(`Week ${week + 1}: ${team.teamName} CHOOSES btb`);
          } else {
            slotsAvailable--;
          }
        } else if (!btbTaken) {
          team.backToBackPracticesCount++;
          btbTaken = true;
          console.log(`Week ${week + 1}: ${team.teamName} FORCED to take btb`);
        }
      }
    }

    const counts = teams.map(t => t.backToBackPracticesCount).sort((a, b) => b - a);
    console.log('\nFinal distribution:', counts, 'Range:', Math.max(...counts) - Math.min(...counts));

    expect(counts.reduce((s, c) => s + c, 0)).toBe(10);
  });

  /**
   * Alternative: NO btb sorting, only rotation by week
   * Let scoring handle balance entirely
   */
  it('distributes back-to-backs with NO btb sorting (pure rotation)', () => {
    const weights = {
      practiceSpacing: 500,
      backToBackPracticeBalance: -800,
    };

    const teamNames = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'];
    const teams: TeamSchedulingState[] = teamNames.map((name, i) =>
      createTeamState({
        teamId: `team${i + 1}`,
        teamName: name,
        backToBackPracticesCount: 0,
      })
    );

    console.log('\n=== Simulation (No BTB Sort, Pure Rotation) ===\n');

    for (let week = 0; week < 10; week++) {
      // Sort by name only (deterministic)
      const sortedTeams = [...teams].sort((a, b) => a.teamName.localeCompare(b.teamName));

      const offset = week % sortedTeams.length;
      const rotatedTeams = [...sortedTeams.slice(offset), ...sortedTeams.slice(0, offset)];

      const context = createScoringContext(teams);
      let slotsAvailable = 5;
      let btbTaken = false;

      for (const team of rotatedTeams) {
        if (slotsAvailable > 0) {
          const tempTeam = { ...team, fieldDatesUsed: new Set(['2024-03-10']) };
          const rawScore = calculateBackToBackPracticeBalanceRaw('2024-03-11', tempTeam, context);
          const btbScore = 0.3 * weights.practiceSpacing + rawScore * weights.backToBackPracticeBalance;
          const nonBtbScore = 1.0 * weights.practiceSpacing;

          if (btbScore > nonBtbScore && !btbTaken) {
            team.backToBackPracticesCount++;
            btbTaken = true;
            console.log(`Week ${week + 1}: ${team.teamName} CHOOSES btb`);
          } else {
            slotsAvailable--;
          }
        } else if (!btbTaken) {
          team.backToBackPracticesCount++;
          btbTaken = true;
          console.log(`Week ${week + 1}: ${team.teamName} FORCED to take btb`);
        }
      }
    }

    const counts = teams.map(t => t.backToBackPracticesCount).sort((a, b) => b - a);
    console.log('\nFinal distribution:', counts, 'Range:', Math.max(...counts) - Math.min(...counts));

    expect(counts.reduce((s, c) => s + c, 0)).toBe(10);
  });
});
