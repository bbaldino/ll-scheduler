import { describe, it, expect } from 'vitest';

/**
 * Simulation test for practice gap balancing
 *
 * This simulates the Majors division practice scheduling scenario:
 * - 6 teams, each needing 2 practices per week
 * - Limited practice slots per week (resource constraints)
 * - Some weeks have blackouts or reduced availability
 *
 * Goal: Ensure practice gaps are balanced across teams
 */

interface TeamState {
  name: string;
  practiceDates: number[]; // Day numbers
  practicesThisWeek: number;
}

interface WeekConfig {
  weekNumber: number;
  startDay: number; // Day number of Monday
  availableSlots: number; // How many practice slots available this week
}

function calculateMaxGap(practiceDates: number[]): number {
  if (practiceDates.length < 2) return 0;
  const sorted = [...practiceDates].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  }
  return maxGap;
}

function calculateGaps(practiceDates: number[]): number[] {
  if (practiceDates.length < 2) return [];
  const sorted = [...practiceDates].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i] - sorted[i - 1]);
  }
  return gaps;
}

describe('Practice Gap Simulation', () => {
  /**
   * Simulate 16 weeks of Majors practice scheduling
   * with resource constraints similar to real scenario
   */
  it('simulates Majors practice scheduling with current approach', () => {
    const TEAMS = 6;
    const PRACTICES_PER_WEEK = 2;
    const WEEKS = 16;

    // Simulate varying slot availability (resource constraints)
    // Some weeks have fewer slots due to games, blackouts, etc.
    const weekConfigs: WeekConfig[] = [];
    for (let w = 0; w < WEEKS; w++) {
      let slots: number;
      // Simulate different availability patterns
      if (w === 6 || w === 10) {
        // Spring break / blackout weeks - very limited
        slots = 4;
      } else if (w >= 5 && w <= 12) {
        // Game season - fields shared with games, fewer practice slots
        slots = 8;
      } else {
        // Pre-season - more availability
        slots = 10;
      }
      weekConfigs.push({
        weekNumber: w,
        startDay: w * 7,
        availableSlots: slots,
      });
    }

    const teams: TeamState[] = [];
    for (let i = 0; i < TEAMS; i++) {
      teams.push({
        name: `Team ${i + 1}`,
        practiceDates: [],
        practicesThisWeek: 0,
      });
    }

    console.log('\n=== Simulating Practice Scheduling (Current Approach) ===\n');

    // Schedule practices week by week
    for (const week of weekConfigs) {
      // Reset weekly counters
      for (const team of teams) {
        team.practicesThisWeek = 0;
      }

      // Calculate how many practices needed this week
      const practicesNeeded = TEAMS * PRACTICES_PER_WEEK; // 12
      const practicesAvailable = week.availableSlots;

      // Sort teams by deficit (most behind first), then by name
      const sortedTeams = [...teams].sort((a, b) => {
        const expectedA = (week.weekNumber + 1) * PRACTICES_PER_WEEK;
        const expectedB = (week.weekNumber + 1) * PRACTICES_PER_WEEK;
        const deficitA = expectedA - a.practiceDates.length;
        const deficitB = expectedB - b.practiceDates.length;
        if (deficitA !== deficitB) return deficitB - deficitA;
        return a.name.localeCompare(b.name);
      });

      // Rotate by week number
      const offset = week.weekNumber % sortedTeams.length;
      const rotatedTeams = [...sortedTeams.slice(offset), ...sortedTeams.slice(0, offset)];

      // Allocate slots
      let slotsUsed = 0;
      for (const team of rotatedTeams) {
        while (team.practicesThisWeek < PRACTICES_PER_WEEK && slotsUsed < practicesAvailable) {
          // Schedule a practice on day 2 or 4 of the week (Tue/Thu)
          const dayOffset = team.practicesThisWeek === 0 ? 1 : 3; // Tue or Thu
          const practiceDay = week.startDay + dayOffset;
          team.practiceDates.push(practiceDay);
          team.practicesThisWeek++;
          slotsUsed++;
        }
      }

      // Log week summary
      const teamSummary = teams.map(t => `${t.name.split(' ')[1]}:${t.practicesThisWeek}`).join(', ');
      console.log(`Week ${week.weekNumber + 1}: ${slotsUsed}/${practicesNeeded} slots used (${practicesAvailable} available) [${teamSummary}]`);
    }

    // Calculate final statistics
    console.log('\n=== Final Results ===\n');
    const maxGaps: number[] = [];
    for (const team of teams) {
      const maxGap = calculateMaxGap(team.practiceDates);
      const gaps = calculateGaps(team.practiceDates);
      maxGaps.push(maxGap);
      console.log(`${team.name}: ${team.practiceDates.length} practices, MaxGap=${maxGap}`);
      console.log(`  Gaps: ${gaps.join(', ')}`);
    }

    const sortedMaxGaps = [...maxGaps].sort((a, b) => b - a);
    const maxGapRange = Math.max(...maxGaps) - Math.min(...maxGaps);
    console.log(`\nMax gap distribution: [${sortedMaxGaps.join(', ')}]`);
    console.log(`Max gap range: ${maxGapRange}`);

    // Current approach has poor gap balance
    // This test documents the current behavior
    expect(maxGapRange).toBeGreaterThan(7);
  });

  /**
   * Test with gap-aware team ordering:
   * Teams with larger current gaps get priority to pick slots
   */
  it('simulates with gap-aware team ordering', () => {
    const TEAMS = 6;
    const PRACTICES_PER_WEEK = 2;
    const WEEKS = 16;

    const weekConfigs: WeekConfig[] = [];
    for (let w = 0; w < WEEKS; w++) {
      let slots: number;
      if (w === 6 || w === 10) {
        slots = 4;
      } else if (w >= 5 && w <= 12) {
        slots = 8;
      } else {
        slots = 10;
      }
      weekConfigs.push({
        weekNumber: w,
        startDay: w * 7,
        availableSlots: slots,
      });
    }

    const teams: TeamState[] = [];
    for (let i = 0; i < TEAMS; i++) {
      teams.push({
        name: `Team ${i + 1}`,
        practiceDates: [],
        practicesThisWeek: 0,
      });
    }

    console.log('\n=== Simulating with Gap-Aware Ordering ===\n');

    for (const week of weekConfigs) {
      for (const team of teams) {
        team.practicesThisWeek = 0;
      }

      const practicesNeeded = TEAMS * PRACTICES_PER_WEEK;
      const practicesAvailable = week.availableSlots;

      // Sort teams by:
      // 1. Current gap since last practice (larger gap = higher priority)
      // 2. Then by deficit
      // 3. Then by name
      const sortedTeams = [...teams].sort((a, b) => {
        // Calculate current gap (days since last practice)
        const currentDayNum = week.startDay;
        const lastPracticeA = a.practiceDates.length > 0
          ? Math.max(...a.practiceDates)
          : -14; // Default to 2 weeks ago if no practices
        const lastPracticeB = b.practiceDates.length > 0
          ? Math.max(...b.practiceDates)
          : -14;
        const gapA = currentDayNum - lastPracticeA;
        const gapB = currentDayNum - lastPracticeB;

        // Primary: larger current gap gets priority
        if (gapA !== gapB) return gapB - gapA;

        // Secondary: higher deficit gets priority
        const expectedA = (week.weekNumber + 1) * PRACTICES_PER_WEEK;
        const expectedB = (week.weekNumber + 1) * PRACTICES_PER_WEEK;
        const deficitA = expectedA - a.practiceDates.length;
        const deficitB = expectedB - b.practiceDates.length;
        if (deficitA !== deficitB) return deficitB - deficitA;

        return a.name.localeCompare(b.name);
      });

      // Rotate by week number
      const offset = week.weekNumber % sortedTeams.length;
      const rotatedTeams = [...sortedTeams.slice(offset), ...sortedTeams.slice(0, offset)];

      let slotsUsed = 0;
      for (const team of rotatedTeams) {
        while (team.practicesThisWeek < PRACTICES_PER_WEEK && slotsUsed < practicesAvailable) {
          const dayOffset = team.practicesThisWeek === 0 ? 1 : 3;
          const practiceDay = week.startDay + dayOffset;
          team.practiceDates.push(practiceDay);
          team.practicesThisWeek++;
          slotsUsed++;
        }
      }

      const teamSummary = teams.map(t => `${t.name.split(' ')[1]}:${t.practicesThisWeek}`).join(', ');
      console.log(`Week ${week.weekNumber + 1}: ${slotsUsed}/${practicesNeeded} slots used [${teamSummary}]`);
    }

    console.log('\n=== Final Results (Gap-Aware) ===\n');
    const maxGaps: number[] = [];
    for (const team of teams) {
      const maxGap = calculateMaxGap(team.practiceDates);
      const gaps = calculateGaps(team.practiceDates);
      maxGaps.push(maxGap);
      console.log(`${team.name}: ${team.practiceDates.length} practices, MaxGap=${maxGap}`);
      console.log(`  Gaps: ${gaps.join(', ')}`);
    }

    const sortedMaxGaps = [...maxGaps].sort((a, b) => b - a);
    const maxGapRange = Math.max(...maxGaps) - Math.min(...maxGaps);
    console.log(`\nMax gap distribution: [${sortedMaxGaps.join(', ')}]`);
    console.log(`Max gap range: ${maxGapRange}`);

    // Gap-aware with rotation is actually worse than current approach
    // because the rotation overrides the gap-based ordering
    expect(maxGapRange).toBeGreaterThan(7);
  });

  /**
   * Test with NO rotation - pure gap-based ordering
   */
  it('simulates with pure gap-based ordering (no rotation)', () => {
    const TEAMS = 6;
    const PRACTICES_PER_WEEK = 2;
    const WEEKS = 16;

    const weekConfigs: WeekConfig[] = [];
    for (let w = 0; w < WEEKS; w++) {
      let slots: number;
      if (w === 6 || w === 10) {
        slots = 4;
      } else if (w >= 5 && w <= 12) {
        slots = 8;
      } else {
        slots = 10;
      }
      weekConfigs.push({
        weekNumber: w,
        startDay: w * 7,
        availableSlots: slots,
      });
    }

    const teams: TeamState[] = [];
    for (let i = 0; i < TEAMS; i++) {
      teams.push({
        name: `Team ${i + 1}`,
        practiceDates: [],
        practicesThisWeek: 0,
      });
    }

    console.log('\n=== Simulating with Pure Gap-Based Ordering (No Rotation) ===\n');

    for (const week of weekConfigs) {
      for (const team of teams) {
        team.practicesThisWeek = 0;
      }

      const practicesNeeded = TEAMS * PRACTICES_PER_WEEK;
      const practicesAvailable = week.availableSlots;

      // Sort ONLY by current gap (no rotation)
      const sortedTeams = [...teams].sort((a, b) => {
        const currentDayNum = week.startDay;
        const lastPracticeA = a.practiceDates.length > 0
          ? Math.max(...a.practiceDates)
          : -14;
        const lastPracticeB = b.practiceDates.length > 0
          ? Math.max(...b.practiceDates)
          : -14;
        const gapA = currentDayNum - lastPracticeA;
        const gapB = currentDayNum - lastPracticeB;

        // Larger gap = higher priority
        if (gapA !== gapB) return gapB - gapA;

        return a.name.localeCompare(b.name);
      });

      // NO rotation - just use gap-sorted order
      let slotsUsed = 0;
      for (const team of sortedTeams) {
        while (team.practicesThisWeek < PRACTICES_PER_WEEK && slotsUsed < practicesAvailable) {
          const dayOffset = team.practicesThisWeek === 0 ? 1 : 3;
          const practiceDay = week.startDay + dayOffset;
          team.practiceDates.push(practiceDay);
          team.practicesThisWeek++;
          slotsUsed++;
        }
      }

      const teamSummary = teams.map(t => `${t.name.split(' ')[1]}:${t.practicesThisWeek}`).join(', ');
      console.log(`Week ${week.weekNumber + 1}: ${slotsUsed}/${practicesNeeded} slots used [${teamSummary}]`);
    }

    console.log('\n=== Final Results (Pure Gap-Based) ===\n');
    const maxGaps: number[] = [];
    for (const team of teams) {
      const maxGap = calculateMaxGap(team.practiceDates);
      const gaps = calculateGaps(team.practiceDates);
      maxGaps.push(maxGap);
      console.log(`${team.name}: ${team.practiceDates.length} practices, MaxGap=${maxGap}`);
      console.log(`  Gaps: ${gaps.join(', ')}`);
    }

    const sortedMaxGaps = [...maxGaps].sort((a, b) => b - a);
    const maxGapRange = Math.max(...maxGaps) - Math.min(...maxGaps);
    console.log(`\nMax gap distribution: [${sortedMaxGaps.join(', ')}]`);
    console.log(`Max gap range: ${maxGapRange}`);

    expect(maxGapRange).toBeLessThanOrEqual(7);
  });

  /**
   * Test with MAX GAP BALANCE ordering
   * Teams with SMALLER max gaps get LOWER priority (they can "afford" to miss a week)
   * Teams with LARGER max gaps get HIGHER priority (they need to catch up)
   *
   * This is similar to BTB balance - spread the pain evenly
   */
  it('simulates with max-gap balance ordering', () => {
    const TEAMS = 6;
    const PRACTICES_PER_WEEK = 2;
    const WEEKS = 16;

    const weekConfigs: WeekConfig[] = [];
    for (let w = 0; w < WEEKS; w++) {
      let slots: number;
      if (w === 6 || w === 10) {
        slots = 4;
      } else if (w >= 5 && w <= 12) {
        slots = 8;
      } else {
        slots = 10;
      }
      weekConfigs.push({
        weekNumber: w,
        startDay: w * 7,
        availableSlots: slots,
      });
    }

    interface TeamStateWithMaxGap extends TeamState {
      maxGapSoFar: number;
    }

    const teams: TeamStateWithMaxGap[] = [];
    for (let i = 0; i < TEAMS; i++) {
      teams.push({
        name: `Team ${i + 1}`,
        practiceDates: [],
        practicesThisWeek: 0,
        maxGapSoFar: 0,
      });
    }

    console.log('\n=== Simulating with Max-Gap Balance Ordering ===\n');

    for (const week of weekConfigs) {
      for (const team of teams) {
        team.practicesThisWeek = 0;
      }

      const practicesNeeded = TEAMS * PRACTICES_PER_WEEK;
      const practicesAvailable = week.availableSlots;

      // Sort by: teams with SMALLER max gap so far get LOWER priority
      // (they can afford to miss a week and let others catch up)
      const sortedTeams = [...teams].sort((a, b) => {
        // Calculate what the gap would be if they don't get a practice this week
        const currentDayNum = week.startDay;
        const lastPracticeA = a.practiceDates.length > 0 ? Math.max(...a.practiceDates) : -7;
        const lastPracticeB = b.practiceDates.length > 0 ? Math.max(...b.practiceDates) : -7;
        const potentialGapA = currentDayNum - lastPracticeA;
        const potentialGapB = currentDayNum - lastPracticeB;

        // Consider both current potential gap AND max gap so far
        // Teams that would create a NEW max gap get priority
        const wouldBeNewMaxA = potentialGapA > a.maxGapSoFar;
        const wouldBeNewMaxB = potentialGapB > b.maxGapSoFar;

        if (wouldBeNewMaxA && !wouldBeNewMaxB) return -1; // A gets priority
        if (!wouldBeNewMaxA && wouldBeNewMaxB) return 1;  // B gets priority

        // If both or neither would create new max, use current gap
        if (potentialGapA !== potentialGapB) return potentialGapB - potentialGapA;

        // Tie-breaker: team with smaller maxGapSoFar can wait
        if (a.maxGapSoFar !== b.maxGapSoFar) return b.maxGapSoFar - a.maxGapSoFar;

        return a.name.localeCompare(b.name);
      });

      let slotsUsed = 0;
      for (const team of sortedTeams) {
        while (team.practicesThisWeek < PRACTICES_PER_WEEK && slotsUsed < practicesAvailable) {
          const dayOffset = team.practicesThisWeek === 0 ? 1 : 3;
          const practiceDay = week.startDay + dayOffset;
          team.practiceDates.push(practiceDay);
          team.practicesThisWeek++;
          slotsUsed++;

          // Update max gap so far
          const gaps = calculateGaps(team.practiceDates);
          team.maxGapSoFar = gaps.length > 0 ? Math.max(...gaps) : 0;
        }
      }

      // Update max gap for teams that didn't get practices
      for (const team of teams) {
        if (team.practicesThisWeek === 0 && team.practiceDates.length > 0) {
          const lastPractice = Math.max(...team.practiceDates);
          const currentGap = week.startDay + 7 - lastPractice; // End of week
          team.maxGapSoFar = Math.max(team.maxGapSoFar, currentGap);
        }
      }

      const teamSummary = teams.map(t => `${t.name.split(' ')[1]}:${t.practicesThisWeek}(max${t.maxGapSoFar})`).join(', ');
      console.log(`Week ${week.weekNumber + 1}: ${slotsUsed}/${practicesNeeded} slots used [${teamSummary}]`);
    }

    console.log('\n=== Final Results (Max-Gap Balance) ===\n');
    const maxGaps: number[] = [];
    for (const team of teams) {
      const maxGap = calculateMaxGap(team.practiceDates);
      const gaps = calculateGaps(team.practiceDates);
      maxGaps.push(maxGap);
      console.log(`${team.name}: ${team.practiceDates.length} practices, MaxGap=${maxGap}`);
      console.log(`  Gaps: ${gaps.join(', ')}`);
    }

    const sortedMaxGaps = [...maxGaps].sort((a, b) => b - a);
    const maxGapRange = Math.max(...maxGaps) - Math.min(...maxGaps);
    console.log(`\nMax gap distribution: [${sortedMaxGaps.join(', ')}]`);
    console.log(`Max gap range: ${maxGapRange}`);

    // This should achieve better balance
    expect(maxGapRange).toBeLessThanOrEqual(5);
  });

  /**
   * MOST REALISTIC simulation based on actual log analysis:
   * - Games are scheduled FIRST and block certain days for each team
   * - Practice slots are VERY LIMITED during game season (only 3-4 per week for Majors)
   * - Team ordering determines who gets scarce slots
   * - Game conflicts can completely block some teams from all available slots
   *
   * Key insight from logs: Teams 4, 5, 6 consistently get 0 practices during
   * game season (weeks 6-13) because their game schedules conflict with ALL
   * available practice slots, while Teams 1, 2, 3 have game schedules that
   * leave practice slots open.
   */
  it('simulates with game conflicts blocking practice access', () => {
    const TEAMS = 6;
    const PRACTICES_PER_WEEK = 1; // Only 1 practice per week during game season
    const WEEKS = 16;

    interface GameConflictTeamState {
      name: string;
      practiceDates: number[];
      practicesThisWeek: number;
      maxGapSoFar: number;
      gameDays: Set<number>; // Days of week (0-6) when this team has games
    }

    // Create week configs - during game season, only 3 practice slots total
    // (representing 2 fields × ~2 days of availability for Majors)
    interface WeekConfigWithGames {
      weekNumber: number;
      startDay: number;
      practiceSlots: number;
      isGameSeason: boolean;
      availablePracticeDays: number[]; // Days of week with practice slots
    }

    const weekConfigs: WeekConfigWithGames[] = [];
    for (let w = 0; w < WEEKS; w++) {
      const isGameSeason = w >= 5 && w <= 12; // Weeks 6-13 (0-indexed 5-12)
      const practiceSlots = isGameSeason ? 3 : 6; // Very limited during games
      // During game season, practices only on Mon, Tue, Fri (games on Wed, Thu, Sat, Sun)
      const availableDays = isGameSeason ? [1, 2, 5] : [1, 2, 3, 4, 5, 6];

      weekConfigs.push({
        weekNumber: w,
        startDay: w * 7,
        practiceSlots,
        isGameSeason,
        availablePracticeDays: availableDays,
      });
    }

    // Teams with different game day patterns (based on actual log analysis)
    // Teams 1-3 have games on Wed, Thu, Sat - leaving Mon, Tue, Fri open
    // Teams 4-6 have games on Tue, Wed, Sat - blocking more practice days
    const teams: GameConflictTeamState[] = [
      { name: 'Team 1', practiceDates: [], practicesThisWeek: 0, maxGapSoFar: 0, gameDays: new Set([3, 4, 6]) },
      { name: 'Team 2', practiceDates: [], practicesThisWeek: 0, maxGapSoFar: 0, gameDays: new Set([3, 4, 6]) },
      { name: 'Team 3', practiceDates: [], practicesThisWeek: 0, maxGapSoFar: 0, gameDays: new Set([3, 4, 6]) },
      { name: 'Team 4', practiceDates: [], practicesThisWeek: 0, maxGapSoFar: 0, gameDays: new Set([2, 3, 6]) }, // Blocks Tue
      { name: 'Team 5', practiceDates: [], practicesThisWeek: 0, maxGapSoFar: 0, gameDays: new Set([1, 3, 6]) }, // Blocks Mon
      { name: 'Team 6', practiceDates: [], practicesThisWeek: 0, maxGapSoFar: 0, gameDays: new Set([2, 5, 6]) }, // Blocks Tue, Fri
    ];

    console.log('\n=== REALISTIC Simulation with Game Conflicts ===\n');
    console.log('Game day patterns:');
    console.log('  Teams 1-3: Wed, Thu, Sat → Can practice Mon, Tue, Fri');
    console.log('  Team 4: Tue, Wed, Sat → Can only practice Mon, Fri');
    console.log('  Team 5: Mon, Wed, Sat → Can only practice Tue, Fri');
    console.log('  Team 6: Tue, Fri, Sat → Can only practice Mon');
    console.log();

    for (const week of weekConfigs) {
      for (const team of teams) {
        team.practicesThisWeek = 0;
      }

      // Sort using max-gap balance approach
      const sortedTeams = [...teams].sort((a, b) => {
        const currentDayNum = week.startDay + 3;
        const lastPracticeA = a.practiceDates.length > 0 ? Math.max(...a.practiceDates) : -14;
        const lastPracticeB = b.practiceDates.length > 0 ? Math.max(...b.practiceDates) : -14;
        const potentialGapA = currentDayNum - lastPracticeA;
        const potentialGapB = currentDayNum - lastPracticeB;

        const wouldBeNewMaxA = potentialGapA > a.maxGapSoFar;
        const wouldBeNewMaxB = potentialGapB > b.maxGapSoFar;

        if (wouldBeNewMaxA && !wouldBeNewMaxB) return -1;
        if (!wouldBeNewMaxA && wouldBeNewMaxB) return 1;
        if (potentialGapA !== potentialGapB) return potentialGapB - potentialGapA;
        if (a.maxGapSoFar !== b.maxGapSoFar) return b.maxGapSoFar - a.maxGapSoFar;
        return a.name.localeCompare(b.name);
      });

      let slotsUsed = 0;
      const usedDays = new Set<number>(); // Track which days are used (1 slot per day)

      for (const team of sortedTeams) {
        if (team.practicesThisWeek >= PRACTICES_PER_WEEK) continue;
        if (slotsUsed >= week.practiceSlots) break;

        // Find an available day that doesn't conflict with team's games
        let scheduledDay: number | null = null;
        for (const dayOfWeek of week.availablePracticeDays) {
          // Skip if this day has a game for this team
          if (week.isGameSeason && team.gameDays.has(dayOfWeek)) continue;
          // Skip if slot on this day is already used
          if (usedDays.has(dayOfWeek)) continue;

          scheduledDay = dayOfWeek;
          break;
        }

        if (scheduledDay !== null) {
          const practiceDay = week.startDay + scheduledDay;
          team.practiceDates.push(practiceDay);
          team.practicesThisWeek++;
          slotsUsed++;
          usedDays.add(scheduledDay);

          const gaps = calculateGaps(team.practiceDates);
          team.maxGapSoFar = gaps.length > 0 ? Math.max(...gaps) : 0;
        }
      }

      const teamSummary = teams.map(t => `${t.name.split(' ')[1]}:${t.practicesThisWeek}`).join(', ');
      const prefix = week.isGameSeason ? '[GAMES] ' : '        ';
      console.log(`${prefix}Week ${week.weekNumber + 1}: ${slotsUsed}/${week.practiceSlots} slots [${teamSummary}]`);
    }

    console.log('\n=== Final Results (Game Conflict Simulation) ===\n');
    const maxGaps: number[] = [];
    for (const team of teams) {
      const maxGap = calculateMaxGap(team.practiceDates);
      const gaps = calculateGaps(team.practiceDates);
      maxGaps.push(maxGap);
      console.log(`${team.name}: ${team.practiceDates.length} practices, MaxGap=${maxGap}`);
      console.log(`  Gaps: ${gaps.join(', ')}`);
    }

    const sortedMaxGaps = [...maxGaps].sort((a, b) => b - a);
    const maxGapRange = Math.max(...maxGaps) - Math.min(...maxGaps);
    console.log(`\nMax gap distribution: [${sortedMaxGaps.join(', ')}]`);
    console.log(`Max gap range: ${maxGapRange}`);

    // This shows the problem - game conflicts create huge imbalances
    // The max-gap ordering can't help if teams physically can't use any slots
    expect(maxGapRange).toBeGreaterThan(10); // Expect poor balance due to game conflicts
  });

  /**
   * Simpler simulation without game conflicts for comparison
   */
  it('simulates realistic scheduler with scoring-based selection', () => {
    const TEAMS = 6;
    const PRACTICES_PER_WEEK = 2;
    const WEEKS = 16;

    // Each week has multiple days available, each with limited slots
    interface DaySlots {
      dayNum: number; // Absolute day number
      dayOfWeek: number; // 0-6
      slotsAvailable: number;
      slotsUsed: number;
    }

    interface WeekConfigRealistic {
      weekNumber: number;
      startDay: number;
      days: DaySlots[];
    }

    // Create week configs with realistic slot distribution
    // Weekdays (Mon-Fri) have more availability, weekends less
    const weekConfigs: WeekConfigRealistic[] = [];
    for (let w = 0; w < WEEKS; w++) {
      const startDay = w * 7;
      const days: DaySlots[] = [];

      // Determine base availability based on season period
      let baseSlots: number;
      if (w === 6 || w === 10) {
        // Blackout weeks - very limited
        baseSlots = 1;
      } else if (w >= 5 && w <= 12) {
        // Game season - shared with games
        baseSlots = 2;
      } else {
        // Pre-season - more availability
        baseSlots = 2;
      }

      // Add available days (Mon=1, Tue=2, Wed=3, Thu=4, Sat=6)
      // Each day has limited slots
      for (const dow of [1, 2, 3, 4, 6]) {
        const dayNum = startDay + dow;
        // Sat has fewer slots
        const slots = dow === 6 ? Math.max(1, baseSlots - 1) : baseSlots;
        days.push({
          dayNum,
          dayOfWeek: dow,
          slotsAvailable: slots,
          slotsUsed: 0,
        });
      }

      weekConfigs.push({
        weekNumber: w,
        startDay,
        days,
      });
    }

    interface RealisticTeamState {
      name: string;
      practiceDates: number[];
      practicesThisWeek: number;
      maxGapSoFar: number;
      dayOfWeekUsage: Map<number, number>; // For daySpread scoring
    }

    const teams: RealisticTeamState[] = [];
    for (let i = 0; i < TEAMS; i++) {
      teams.push({
        name: `Team ${i + 1}`,
        practiceDates: [],
        practicesThisWeek: 0,
        maxGapSoFar: 0,
        dayOfWeekUsage: new Map(),
      });
    }

    // Scoring function that mimics the real scheduler
    // Returns score for picking a specific day (higher = better)
    function scoreDay(team: RealisticTeamState, day: DaySlots, weekStart: number): number {
      let score = 0;

      // daySpread: prefer days not used much by this team
      const dowUsage = team.dayOfWeekUsage.get(day.dayOfWeek) || 0;
      const totalPractices = team.practiceDates.length || 1;
      const daySpreadRaw = 1 - (dowUsage / totalPractices);
      score += daySpreadRaw * 100; // weight: 100

      // dayGap: prefer days further from last practice
      const lastPractice = team.practiceDates.length > 0
        ? Math.max(...team.practiceDates)
        : weekStart - 14;
      const gap = day.dayNum - lastPractice;
      const dayGapRaw = gap >= 3 ? 1 : (gap === 2 ? 0.8 : 0.5);
      score += dayGapRaw * 100; // weight: 100

      // practiceSpacing: prefer NOT back-to-back
      const isBackToBack = team.practiceDates.some(d => Math.abs(d - day.dayNum) <= 1);
      const spacingRaw = isBackToBack ? 0 : 1;
      score += spacingRaw * 500; // weight: 500

      // largeGapPenalty: penalize if this creates a large gap
      // (this is NEW - not in original simulation)
      const potentialGap = day.dayNum - lastPractice;
      if (potentialGap > 5) {
        const gapPenaltyRaw = (potentialGap - 5) / 10; // Scale 0-1
        score -= gapPenaltyRaw * 600; // weight: -600
      }

      // earliestTime: prefer weekday over weekend (simulating earlier times)
      const isWeekday = day.dayOfWeek >= 1 && day.dayOfWeek <= 5;
      score += (isWeekday ? 1 : 0.5) * 50;

      return score;
    }

    console.log('\n=== REALISTIC Simulation (Scoring-Based Selection) ===\n');

    for (const week of weekConfigs) {
      // Reset weekly counters
      for (const team of teams) {
        team.practicesThisWeek = 0;
      }
      for (const day of week.days) {
        day.slotsUsed = 0;
      }

      // Draft rounds - keep going until all teams have enough or no slots left
      let round = 0;
      const maxRounds = 10;

      while (round < maxRounds) {
        // Get teams that still need practices this week
        const teamsNeedingPractices = teams.filter(t => t.practicesThisWeek < PRACTICES_PER_WEEK);
        if (teamsNeedingPractices.length === 0) break;

        // Sort using max-gap balance approach (same as real scheduler)
        const sortedTeams = [...teamsNeedingPractices].sort((a, b) => {
          const currentDayNum = week.startDay + 3; // Mid-week
          const lastPracticeA = a.practiceDates.length > 0 ? Math.max(...a.practiceDates) : -14;
          const lastPracticeB = b.practiceDates.length > 0 ? Math.max(...b.practiceDates) : -14;
          const potentialGapA = currentDayNum - lastPracticeA;
          const potentialGapB = currentDayNum - lastPracticeB;

          const wouldBeNewMaxA = potentialGapA > a.maxGapSoFar;
          const wouldBeNewMaxB = potentialGapB > b.maxGapSoFar;

          if (wouldBeNewMaxA && !wouldBeNewMaxB) return -1;
          if (!wouldBeNewMaxA && wouldBeNewMaxB) return 1;

          if (potentialGapA !== potentialGapB) return potentialGapB - potentialGapA;

          // Tie-breaker: LARGER maxGapSoFar gets priority (they need to catch up)
          if (a.maxGapSoFar !== b.maxGapSoFar) return b.maxGapSoFar - a.maxGapSoFar;

          return a.name.localeCompare(b.name);
        });

        let anyScheduledThisRound = false;

        for (const team of sortedTeams) {
          if (team.practicesThisWeek >= PRACTICES_PER_WEEK) continue;

          // Get available days (have slots left)
          const availableDays = week.days.filter(d => d.slotsUsed < d.slotsAvailable);
          if (availableDays.length === 0) break;

          // Score each available day and pick the best one
          let bestDay: DaySlots | null = null;
          let bestScore = -Infinity;

          for (const day of availableDays) {
            const score = scoreDay(team, day, week.startDay);
            if (score > bestScore) {
              bestScore = score;
              bestDay = day;
            }
          }

          if (bestDay) {
            // Schedule practice on this day
            team.practiceDates.push(bestDay.dayNum);
            team.practicesThisWeek++;
            bestDay.slotsUsed++;

            // Update dayOfWeekUsage
            const dowCount = team.dayOfWeekUsage.get(bestDay.dayOfWeek) || 0;
            team.dayOfWeekUsage.set(bestDay.dayOfWeek, dowCount + 1);

            // Update maxGapSoFar
            const gaps = calculateGaps(team.practiceDates);
            team.maxGapSoFar = gaps.length > 0 ? Math.max(...gaps) : 0;

            anyScheduledThisRound = true;
          }
        }

        if (!anyScheduledThisRound) break;
        round++;
      }

      // Log week summary
      const totalSlots = week.days.reduce((sum, d) => sum + d.slotsAvailable, 0);
      const usedSlots = week.days.reduce((sum, d) => sum + d.slotsUsed, 0);
      const teamSummary = teams.map(t => `${t.name.split(' ')[1]}:${t.practicesThisWeek}`).join(', ');
      console.log(`Week ${week.weekNumber + 1}: ${usedSlots}/${totalSlots} slots [${teamSummary}]`);
    }

    console.log('\n=== Final Results (Realistic Simulation) ===\n');
    const maxGaps: number[] = [];
    for (const team of teams) {
      const maxGap = calculateMaxGap(team.practiceDates);
      const gaps = calculateGaps(team.practiceDates);
      maxGaps.push(maxGap);
      console.log(`${team.name}: ${team.practiceDates.length} practices, MaxGap=${maxGap}`);
      console.log(`  Gaps: ${gaps.join(', ')}`);
    }

    const sortedMaxGaps = [...maxGaps].sort((a, b) => b - a);
    const maxGapRange = Math.max(...maxGaps) - Math.min(...maxGaps);
    console.log(`\nMax gap distribution: [${sortedMaxGaps.join(', ')}]`);
    console.log(`Max gap range: ${maxGapRange}`);

    // This should show what the realistic scheduler achieves
    // Adjust expectation based on results
    expect(maxGapRange).toBeLessThanOrEqual(10);
  });
});
