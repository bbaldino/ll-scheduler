import { describe, it, expect } from 'vitest';
import { generateRoundRobinMatchups } from './draft.js';

describe('generateRoundRobinMatchups - detailed example', () => {
  it('6 teams with 2 games per matchup - shows full breakdown', () => {
    const teamIds = ['team1', 'team2', 'team3', 'team4', 'team5', 'team6'];
    const rounds = generateRoundRobinMatchups(teamIds, 2);
    const allMatchups = rounds.flatMap(r => r.matchups);

    console.log('\n=== 6 Teams, 2 Games Per Matchup ===\n');
    console.log('Total matchups:', allMatchups.length);
    console.log('Total rounds:', rounds.length);

    // Show per-pairing breakdown
    const pairingKey = (a: string, b: string) => a < b ? `${a}-${b}` : `${b}-${a}`;
    const pairingData = new Map<string, { games: number; homeCount: Map<string, number> }>();

    for (const m of allMatchups) {
      const key = pairingKey(m.homeTeamId, m.awayTeamId);
      if (!pairingData.has(key)) {
        pairingData.set(key, { games: 0, homeCount: new Map() });
      }
      const data = pairingData.get(key)!;
      data.games++;
      data.homeCount.set(m.homeTeamId, (data.homeCount.get(m.homeTeamId) || 0) + 1);
    }

    console.log('\nPer-pairing breakdown (should be 1-1 for each):');
    for (const [pairing, data] of pairingData) {
      const [t1, t2] = pairing.split('-');
      const t1Home = data.homeCount.get(t1) || 0;
      const t2Home = data.homeCount.get(t2) || 0;
      const balance = t1Home === t2Home ? '✓' : '⚠';
      console.log(`  ${pairing}: ${t1} home ${t1Home}x, ${t2} home ${t2Home}x ${balance}`);
    }

    // Show per-team totals
    const teamHome = new Map<string, number>();
    const teamAway = new Map<string, number>();
    for (const m of allMatchups) {
      teamHome.set(m.homeTeamId, (teamHome.get(m.homeTeamId) || 0) + 1);
      teamAway.set(m.awayTeamId, (teamAway.get(m.awayTeamId) || 0) + 1);
    }

    console.log('\nPer-team totals (should be 5 home, 5 away each):');
    for (const id of teamIds) {
      const home = teamHome.get(id) || 0;
      const away = teamAway.get(id) || 0;
      const balance = home === away ? '✓' : '⚠';
      console.log(`  ${id}: ${home} home, ${away} away ${balance}`);
    }

    // Assertions
    expect(allMatchups.length).toBe(30); // 15 pairings × 2 games

    // Each pairing should have 1-1 home/away split
    for (const [, data] of pairingData) {
      const counts = Array.from(data.homeCount.values());
      expect(counts).toEqual([1, 1]);
    }

    // Each team should have 5 home, 5 away
    for (const id of teamIds) {
      expect(teamHome.get(id)).toBe(5);
      expect(teamAway.get(id)).toBe(5);
    }
  });
});

describe('generateRoundRobinMatchups - 6 teams, 15 games each', () => {
  it('6 teams with 3 games per matchup (15 games each) - shows full breakdown', () => {
    const teamIds = ['team1', 'team2', 'team3', 'team4', 'team5', 'team6'];
    const rounds = generateRoundRobinMatchups(teamIds, 3);
    const allMatchups = rounds.flatMap(r => r.matchups);

    console.log('\n=== 6 Teams, 3 Games Per Matchup (15 games each) ===\n');
    console.log('Total matchups:', allMatchups.length);
    console.log('Total rounds:', rounds.length);

    // Show per-pairing breakdown
    const pairingKey = (a: string, b: string) => a < b ? `${a}-${b}` : `${b}-${a}`;
    const pairingData = new Map<string, { games: number; homeCount: Map<string, number> }>();

    for (const m of allMatchups) {
      const key = pairingKey(m.homeTeamId, m.awayTeamId);
      if (!pairingData.has(key)) {
        pairingData.set(key, { games: 0, homeCount: new Map() });
      }
      const data = pairingData.get(key)!;
      data.games++;
      data.homeCount.set(m.homeTeamId, (data.homeCount.get(m.homeTeamId) || 0) + 1);
    }

    console.log('\nPer-pairing breakdown (should be 2-1 for each, since 3 games):');
    let pairingIssues = 0;
    for (const [pairing, data] of pairingData) {
      const [t1, t2] = pairing.split('-');
      const t1Home = data.homeCount.get(t1) || 0;
      const t2Home = data.homeCount.get(t2) || 0;
      const diff = Math.abs(t1Home - t2Home);
      const balance = diff <= 1 ? '✓' : '⚠';
      if (diff > 1) pairingIssues++;
      console.log(`  ${pairing}: ${t1} home ${t1Home}x, ${t2} home ${t2Home}x ${balance}`);
    }

    // Show per-team totals
    const teamHome = new Map<string, number>();
    const teamAway = new Map<string, number>();
    for (const m of allMatchups) {
      teamHome.set(m.homeTeamId, (teamHome.get(m.homeTeamId) || 0) + 1);
      teamAway.set(m.awayTeamId, (teamAway.get(m.awayTeamId) || 0) + 1);
    }

    console.log('\nPer-team totals (15 games each, ideal is 8/7 or 7/8):');
    let teamIssues = 0;
    for (const id of teamIds) {
      const home = teamHome.get(id) || 0;
      const away = teamAway.get(id) || 0;
      const diff = Math.abs(home - away);
      const balance = diff <= 1 ? '✓' : (diff <= 2 ? '~' : '⚠');
      if (diff > 2) teamIssues++;
      console.log(`  ${id}: ${home} home, ${away} away (diff: ${diff}) ${balance}`);
    }

    console.log('\nSummary:');
    console.log(`  Pairing issues (diff > 1): ${pairingIssues}`);
    console.log(`  Team issues (diff > 2): ${teamIssues}`);

    // Assertions
    expect(allMatchups.length).toBe(45); // 15 pairings × 3 games

    // Each pairing should have diff <= 1 (2-1 split for 3 games)
    for (const [, data] of pairingData) {
      const counts = Array.from(data.homeCount.values());
      const diff = counts.length === 2 ? Math.abs(counts[0] - counts[1]) : counts[0];
      expect(diff).toBeLessThanOrEqual(1);
    }

    // Each team should have diff <= 2 for overall balance
    for (const id of teamIds) {
      const home = teamHome.get(id) || 0;
      const away = teamAway.get(id) || 0;
      const diff = Math.abs(home - away);
      expect(diff).toBeLessThanOrEqual(2);
    }
  });
});

describe('simulating dropped games scenario', () => {
  it('shows imbalance when games are dropped from 15-game schedule', () => {
    const teamIds = ['team1', 'team2', 'team3', 'team4', 'team5', 'team6'];
    const rounds = generateRoundRobinMatchups(teamIds, 3);
    const allMatchups = rounds.flatMap(r => r.matchups);

    console.log('\n=== Simulating Dropped Games (14 instead of 15) ===\n');

    // Simulate dropping one game from team1's schedule
    // Find a game involving team1 and remove it
    const team1Games = allMatchups.filter(
      m => m.homeTeamId === 'team1' || m.awayTeamId === 'team1'
    );
    const gameToRemove = team1Games[0]; // Remove first game

    const scheduledGames = allMatchups.filter(m => m !== gameToRemove);

    console.log(`Original games: ${allMatchups.length}`);
    console.log(`After dropping 1 game: ${scheduledGames.length}`);
    console.log(`Dropped: ${gameToRemove.homeTeamId} vs ${gameToRemove.awayTeamId}`);

    // Analyze balance BEFORE rebalancing
    const pairingKey = (a: string, b: string) => a < b ? `${a}-${b}` : `${b}-${a}`;
    const gamesByPair = new Map<string, typeof scheduledGames>();
    for (const game of scheduledGames) {
      const key = pairingKey(game.homeTeamId, game.awayTeamId);
      if (!gamesByPair.has(key)) {
        gamesByPair.set(key, []);
      }
      gamesByPair.get(key)!.push(game);
    }

    console.log('\nPer-pairing balance BEFORE rebalancing:');
    let beforeIssues = 0;
    for (const [key, games] of gamesByPair) {
      const [teamA, teamB] = key.split('-');
      const teamAHome = games.filter(g => g.homeTeamId === teamA).length;
      const teamBHome = games.filter(g => g.homeTeamId === teamB).length;
      const diff = Math.abs(teamAHome - teamBHome);
      if (diff > 1) {
        beforeIssues++;
        console.log(`  ${key}: ${teamA} home ${teamAHome}x, ${teamB} home ${teamBHome}x ⚠ IMBALANCED`);
      }
    }
    console.log(`  Imbalanced pairings: ${beforeIssues}`);

    // Now simulate rebalancing (same logic as rebalanceScheduledHomeAway)
    const teamHomeCount = new Map<string, number>();
    const teamAwayCount = new Map<string, number>();

    for (const game of scheduledGames) {
      teamHomeCount.set(game.homeTeamId, (teamHomeCount.get(game.homeTeamId) || 0) + 1);
      teamAwayCount.set(game.awayTeamId, (teamAwayCount.get(game.awayTeamId) || 0) + 1);
    }

    // Rebalance each pairing
    let swapsMade = 0;
    for (const [key, games] of gamesByPair) {
      const [teamA, teamB] = key.split('-');
      const teamAGames = games.filter(g => g.homeTeamId === teamA);
      const teamBGames = games.filter(g => g.homeTeamId === teamB);

      const totalGames = games.length;
      const idealEach = Math.floor(totalGames / 2);

      let targetAHome = idealEach;
      let targetBHome = idealEach;

      if (totalGames % 2 === 1) {
        const teamAImbalance = (teamHomeCount.get(teamA) || 0) - (teamAwayCount.get(teamA) || 0);
        const teamBImbalance = (teamHomeCount.get(teamB) || 0) - (teamAwayCount.get(teamB) || 0);

        if (teamAImbalance <= teamBImbalance) {
          targetAHome = idealEach + 1;
        } else {
          targetBHome = idealEach + 1;
        }
      }

      while (teamAGames.length > targetAHome && teamBGames.length < targetBHome) {
        const gameToSwap = teamAGames.pop()!;
        const temp = gameToSwap.homeTeamId;
        gameToSwap.homeTeamId = gameToSwap.awayTeamId;
        gameToSwap.awayTeamId = temp;
        teamBGames.push(gameToSwap);

        teamHomeCount.set(teamA, (teamHomeCount.get(teamA) || 0) - 1);
        teamAwayCount.set(teamA, (teamAwayCount.get(teamA) || 0) + 1);
        teamHomeCount.set(teamB, (teamHomeCount.get(teamB) || 0) + 1);
        teamAwayCount.set(teamB, (teamAwayCount.get(teamB) || 0) - 1);

        swapsMade++;
      }

      while (teamBGames.length > targetBHome && teamAGames.length < targetAHome) {
        const gameToSwap = teamBGames.pop()!;
        const temp = gameToSwap.homeTeamId;
        gameToSwap.homeTeamId = gameToSwap.awayTeamId;
        gameToSwap.awayTeamId = temp;
        teamAGames.push(gameToSwap);

        teamHomeCount.set(teamB, (teamHomeCount.get(teamB) || 0) - 1);
        teamAwayCount.set(teamB, (teamAwayCount.get(teamB) || 0) + 1);
        teamHomeCount.set(teamA, (teamHomeCount.get(teamA) || 0) + 1);
        teamAwayCount.set(teamA, (teamAwayCount.get(teamA) || 0) - 1);

        swapsMade++;
      }
    }

    console.log(`\nSwaps made: ${swapsMade}`);

    // Verify AFTER rebalancing
    console.log('\nPer-pairing balance AFTER rebalancing:');
    let afterIssues = 0;
    for (const [key, games] of gamesByPair) {
      const [teamA, teamB] = key.split('-');
      const teamAHome = games.filter(g => g.homeTeamId === teamA).length;
      const teamBHome = games.filter(g => g.homeTeamId === teamB).length;
      const diff = Math.abs(teamAHome - teamBHome);
      const status = diff <= 1 ? '✓' : '⚠';
      if (diff > 1) afterIssues++;
      console.log(`  ${key}: ${teamA} home ${teamAHome}x, ${teamB} home ${teamBHome}x ${status}`);
    }
    console.log(`  Imbalanced pairings: ${afterIssues}`);

    console.log('\nPer-team totals AFTER rebalancing:');
    for (const id of teamIds) {
      const home = teamHomeCount.get(id) || 0;
      const away = teamAwayCount.get(id) || 0;
      const total = home + away;
      const diff = Math.abs(home - away);
      const status = diff <= 1 ? '✓' : (diff <= 2 ? '~' : '⚠');
      console.log(`  ${id}: ${total} games (${home} home, ${away} away, diff: ${diff}) ${status}`);
    }

    // Assertions - after rebalancing, pairings should be balanced
    expect(afterIssues).toBe(0);

    // All pairings should have diff <= 1
    for (const [, games] of gamesByPair) {
      const teamAId = games[0].homeTeamId < games[0].awayTeamId ? games[0].homeTeamId : games[0].awayTeamId;
      const teamAHome = games.filter(g => g.homeTeamId === teamAId).length;
      const teamBHome = games.length - teamAHome;
      expect(Math.abs(teamAHome - teamBHome)).toBeLessThanOrEqual(1);
    }
  });
});

describe('generateRoundRobinMatchups', () => {
  // Helper to analyze matchup results
  function analyzeMatchups(teamIds: string[], gamesPerMatchup: number) {
    const rounds = generateRoundRobinMatchups(teamIds, gamesPerMatchup);
    const allMatchups = rounds.flatMap(r => r.matchups);

    // Count games per team
    const teamGameCount = new Map<string, number>();
    const teamHomeCount = new Map<string, number>();
    const teamAwayCount = new Map<string, number>();
    for (const id of teamIds) {
      teamGameCount.set(id, 0);
      teamHomeCount.set(id, 0);
      teamAwayCount.set(id, 0);
    }

    // Count games per pairing and home/away within pairings
    const pairingKey = (a: string, b: string) => a < b ? `${a}-${b}` : `${b}-${a}`;
    const pairingCount = new Map<string, number>();
    const pairingHomeCount = new Map<string, Map<string, number>>();

    for (const m of allMatchups) {
      // Update team counts
      teamGameCount.set(m.homeTeamId, (teamGameCount.get(m.homeTeamId) || 0) + 1);
      teamGameCount.set(m.awayTeamId, (teamGameCount.get(m.awayTeamId) || 0) + 1);
      teamHomeCount.set(m.homeTeamId, (teamHomeCount.get(m.homeTeamId) || 0) + 1);
      teamAwayCount.set(m.awayTeamId, (teamAwayCount.get(m.awayTeamId) || 0) + 1);

      // Update pairing counts
      const key = pairingKey(m.homeTeamId, m.awayTeamId);
      pairingCount.set(key, (pairingCount.get(key) || 0) + 1);

      if (!pairingHomeCount.has(key)) {
        pairingHomeCount.set(key, new Map());
      }
      const homeMap = pairingHomeCount.get(key)!;
      homeMap.set(m.homeTeamId, (homeMap.get(m.homeTeamId) || 0) + 1);
    }

    return {
      rounds,
      allMatchups,
      teamGameCount,
      teamHomeCount,
      teamAwayCount,
      pairingCount,
      pairingHomeCount,
    };
  }

  describe('with even number of teams (6 teams)', () => {
    const teamIds = ['team1', 'team2', 'team3', 'team4', 'team5', 'team6'];

    it('generates correct number of matchups for 1 game per matchup', () => {
      const { allMatchups, pairingCount } = analyzeMatchups(teamIds, 1);

      // 6 teams = 15 unique pairings, 1 game each = 15 total games
      expect(allMatchups.length).toBe(15);
      expect(pairingCount.size).toBe(15);

      // Each pairing should have exactly 1 game
      for (const [, count] of pairingCount) {
        expect(count).toBe(1);
      }
    });

    it('generates correct number of matchups for 2 games per matchup', () => {
      const { allMatchups, pairingCount } = analyzeMatchups(teamIds, 2);

      // 6 teams = 15 unique pairings, 2 games each = 30 total games
      expect(allMatchups.length).toBe(30);

      // Each pairing should have exactly 2 games
      for (const [, count] of pairingCount) {
        expect(count).toBe(2);
      }
    });

    it('generates correct number of matchups for 3 games per matchup', () => {
      const { allMatchups, pairingCount } = analyzeMatchups(teamIds, 3);

      // 6 teams = 15 unique pairings, 3 games each = 45 total games
      expect(allMatchups.length).toBe(45);

      // Each pairing should have exactly 3 games
      for (const [, count] of pairingCount) {
        expect(count).toBe(3);
      }
    });

    it('each team plays the same number of games', () => {
      const { teamGameCount } = analyzeMatchups(teamIds, 2);

      // Each team plays 5 opponents x 2 games = 10 games
      for (const [, count] of teamGameCount) {
        expect(count).toBe(10);
      }
    });

    it('home/away is balanced within each pairing (diff <= 1)', () => {
      const { pairingHomeCount, pairingCount } = analyzeMatchups(teamIds, 3);

      for (const [key, count] of pairingCount) {
        const homeMap = pairingHomeCount.get(key)!;
        const homeCounts = Array.from(homeMap.values());

        // For 3 games, one team has 2 home, other has 1
        // Difference should be <= 1
        if (homeCounts.length === 2) {
          const diff = Math.abs(homeCounts[0] - homeCounts[1]);
          expect(diff).toBeLessThanOrEqual(1);
        } else if (homeCounts.length === 1) {
          // One team has all home games - this should only happen for 1 game
          expect(count).toBe(1);
        }
      }
    });

    it('overall team home/away balance is reasonable (diff <= 2)', () => {
      const { teamHomeCount, teamAwayCount } = analyzeMatchups(teamIds, 3);

      for (const id of teamIds) {
        const home = teamHomeCount.get(id) || 0;
        const away = teamAwayCount.get(id) || 0;
        const diff = Math.abs(home - away);

        // With 6 teams and 3 games per matchup = 15 games per team
        // Perfect balance would be 7.5/7.5, so diff of 1 is expected
        // Allow up to 2 for edge cases
        expect(diff).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('with odd number of teams (5 teams)', () => {
    const teamIds = ['team1', 'team2', 'team3', 'team4', 'team5'];

    it('generates correct number of matchups for 1 game per matchup', () => {
      const { allMatchups, pairingCount } = analyzeMatchups(teamIds, 1);

      // 5 teams = 10 unique pairings, 1 game each = 10 total games
      expect(allMatchups.length).toBe(10);
      expect(pairingCount.size).toBe(10);
    });

    it('generates correct number of matchups for 2 games per matchup', () => {
      const { allMatchups, pairingCount } = analyzeMatchups(teamIds, 2);

      // 5 teams = 10 unique pairings, 2 games each = 20 total games
      expect(allMatchups.length).toBe(20);

      for (const [, count] of pairingCount) {
        expect(count).toBe(2);
      }
    });

    it('each team plays the same number of games', () => {
      const { teamGameCount } = analyzeMatchups(teamIds, 2);

      // Each team plays 4 opponents x 2 games = 8 games
      for (const [, count] of teamGameCount) {
        expect(count).toBe(8);
      }
    });

    it('home/away is balanced within each pairing (diff <= 1)', () => {
      const { pairingHomeCount, pairingCount } = analyzeMatchups(teamIds, 3);

      for (const [key, count] of pairingCount) {
        const homeMap = pairingHomeCount.get(key)!;
        const homeCounts = Array.from(homeMap.values());

        if (homeCounts.length === 2) {
          const diff = Math.abs(homeCounts[0] - homeCounts[1]);
          expect(diff).toBeLessThanOrEqual(1);
        }
      }
    });

    it('overall team home/away balance is reasonable (diff <= 2)', () => {
      const { teamHomeCount, teamAwayCount } = analyzeMatchups(teamIds, 3);

      for (const id of teamIds) {
        const home = teamHomeCount.get(id) || 0;
        const away = teamAwayCount.get(id) || 0;
        const diff = Math.abs(home - away);
        expect(diff).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('edge cases', () => {
    it('handles 2 teams', () => {
      const teamIds = ['team1', 'team2'];
      const { allMatchups, pairingCount } = analyzeMatchups(teamIds, 3);

      // 2 teams = 1 pairing, 3 games
      expect(allMatchups.length).toBe(3);
      expect(pairingCount.size).toBe(1);
    });

    it('handles single team (returns empty)', () => {
      const rounds = generateRoundRobinMatchups(['team1'], 1);
      expect(rounds.length).toBe(0);
    });

    it('handles empty team list', () => {
      const rounds = generateRoundRobinMatchups([], 1);
      expect(rounds.length).toBe(0);
    });
  });

  describe('home/away balance with partial cycles', () => {
    // This simulates what happens when we use only some rounds from a larger generation
    it('maintains per-pairing balance even when taking subset of rounds', () => {
      const teamIds = ['team1', 'team2', 'team3', 'team4', 'team5', 'team6'];

      // Generate 3 cycles but only use first 2 worth of rounds
      const allRounds = generateRoundRobinMatchups(teamIds, 3);
      const roundsPerCycle = teamIds.length - 1; // 5 rounds per cycle
      const roundsToUse = allRounds.slice(0, roundsPerCycle * 2); // 10 rounds

      const matchups = roundsToUse.flatMap(r => r.matchups);

      // Verify per-pairing balance
      const pairingKey = (a: string, b: string) => a < b ? `${a}-${b}` : `${b}-${a}`;
      const pairingHomeCount = new Map<string, Map<string, number>>();

      for (const m of matchups) {
        const key = pairingKey(m.homeTeamId, m.awayTeamId);
        if (!pairingHomeCount.has(key)) {
          pairingHomeCount.set(key, new Map());
        }
        const homeMap = pairingHomeCount.get(key)!;
        homeMap.set(m.homeTeamId, (homeMap.get(m.homeTeamId) || 0) + 1);
      }

      // Each pairing should have played 2 games (2 cycles)
      // Home/away should be 1-1 for each
      for (const [, homeMap] of pairingHomeCount) {
        const counts = Array.from(homeMap.values());
        if (counts.length === 2) {
          expect(counts[0]).toBe(1);
          expect(counts[1]).toBe(1);
        }
      }
    });
  });
});
