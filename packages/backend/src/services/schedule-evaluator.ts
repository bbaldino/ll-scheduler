import type {
  ScheduleEvaluationResult,
  WeeklyRequirementsReport,
  TeamWeeklyReport,
  WeekSummary,
  HomeAwayBalanceReport,
  TeamHomeAwayReport,
  ConstraintViolationsReport,
  ConstraintViolation,
  GameDayPreferencesReport,
  DivisionGameDayReport,
  TeamGameDayDistribution,
  GameSpacingReport,
  TeamGameSpacingReport,
  MatchupBalanceReport,
  DivisionMatchupReport,
  TeamMatchupReport,
  OpponentMatchup,
  GameSlotEfficiencyReport,
  IsolatedGameSlot,
  ScheduledEvent,
  Team,
  Division,
  DivisionConfig,
  Season,
  SeasonField,
  GameDayPreference,
} from '@ll-scheduler/shared';
import { listScheduledEvents } from './scheduled-events.js';
import { getSeasonById } from './seasons.js';
import { listTeams } from './teams.js';
import { listDivisions } from './divisions.js';
import { listDivisionConfigsBySeasonId } from './division-configs.js';
import { listSeasonFields } from './season-fields.js';

/**
 * Main evaluation function that runs all checks on a schedule
 */
export async function evaluateSchedule(
  db: D1Database,
  seasonId: string
): Promise<ScheduleEvaluationResult> {
  // Fetch season
  const season = await getSeasonById(db, seasonId);
  if (!season) {
    throw new Error('Season not found');
  }

  const [events, teams, divisions, divisionConfigs, seasonFields] = await Promise.all([
    listScheduledEvents(db, { seasonId }),
    listTeams(db, seasonId),
    listDivisions(db),
    listDivisionConfigsBySeasonId(db, seasonId),
    listSeasonFields(db, seasonId),
  ]);

  // Create lookup maps
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const divisionMap = new Map(divisions.map((d) => [d.id, d]));
  const configByDivision = new Map(divisionConfigs.map((c) => [c.divisionId, c]));
  const fieldMap = new Map(seasonFields.map((f) => [f.fieldId, f]));

  // Run all evaluations
  const weeklyRequirements = evaluateWeeklyRequirements(
    events,
    teams,
    divisionMap,
    configByDivision,
    season
  );
  const homeAwayBalance = evaluateHomeAwayBalance(events, teams, divisionMap);
  const constraintViolations = evaluateConstraintViolations(
    events,
    teamMap,
    divisionMap,
    configByDivision,
    season
  );
  const gameDayPreferences = evaluateGameDayPreferences(
    events,
    teams,
    divisionMap,
    configByDivision
  );
  const gameSpacing = evaluateGameSpacing(events, teams, divisionMap);
  const matchupBalance = evaluateMatchupBalance(events, teams, divisionMap, configByDivision, season);
  const gameSlotEfficiency = evaluateGameSlotEfficiency(events, teamMap, divisionMap, fieldMap);

  // Calculate overall score
  const checks = [
    weeklyRequirements.passed,
    homeAwayBalance.passed,
    constraintViolations.passed,
    gameDayPreferences.passed,
    gameSpacing.passed,
    matchupBalance.passed,
    gameSlotEfficiency.passed,
  ];
  const passedCount = checks.filter(Boolean).length;
  const overallScore = Math.round((passedCount / checks.length) * 100);

  return {
    overallScore,
    timestamp: new Date().toISOString(),
    seasonId,
    weeklyRequirements,
    homeAwayBalance,
    constraintViolations,
    gameDayPreferences,
    gameSpacing,
    matchupBalance,
    gameSlotEfficiency,
  };
}

/**
 * Get the Monday of the week for a given date
 */
function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  const monday = new Date(date.setDate(diff));
  return monday.toISOString().split('T')[0];
}

/**
 * Get the Sunday of the week for a given date
 */
function getWeekEnd(dateStr: string): string {
  const weekStart = getWeekStart(dateStr);
  const monday = new Date(weekStart + 'T00:00:00');
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday.toISOString().split('T')[0];
}

/**
 * Get allowed event types for a week based on season dates
 */
function getAllowedEventTypesForWeek(
  weekStart: string,
  weekEnd: string,
  season: Season
): Set<string> {
  const allowed = new Set<string>();

  // Check if week overlaps with season
  if (weekStart > season.endDate || weekEnd < season.startDate) {
    return allowed;
  }

  // Practices and cages are allowed for the full season
  allowed.add('practice');
  allowed.add('cage');

  // Games are only allowed from gamesStartDate onwards
  const gamesStart = season.gamesStartDate || season.startDate;
  if (weekEnd >= gamesStart) {
    allowed.add('game');
  }

  return allowed;
}

/**
 * Get games per week for a division, accounting for per-week overrides
 * gameWeekNumber is 1-based (Week 1 = first game week)
 */
function getGamesPerWeekForDivision(
  config: DivisionConfig,
  gameWeekNumber: number
): number {
  const override = config.gameWeekOverrides?.find(o => o.weekNumber === gameWeekNumber);
  if (override !== undefined) {
    return override.gamesPerWeek;
  }
  return config.gamesPerWeek;
}

/**
 * Generate game weeks from gamesStartDate to endDate
 * Returns array with 1-based week numbers and date ranges
 */
function generateGameWeeks(season: Season): Array<{ weekNumber: number; start: string; end: string }> {
  const gamesStart = season.gamesStartDate || season.startDate;
  const gameWeeks: Array<{ weekNumber: number; start: string; end: string }> = [];

  let weekNumber = 1;
  let currentWeekStart = getWeekStart(gamesStart);

  while (currentWeekStart <= season.endDate) {
    const weekEnd = getWeekEnd(currentWeekStart);
    gameWeeks.push({
      weekNumber,
      start: currentWeekStart,
      end: weekEnd,
    });

    const nextWeek = new Date(currentWeekStart + 'T00:00:00');
    nextWeek.setDate(nextWeek.getDate() + 7);
    currentWeekStart = nextWeek.toISOString().split('T')[0];
    weekNumber++;
  }

  return gameWeeks;
}

/**
 * Evaluate weekly requirements for all teams
 */
function evaluateWeeklyRequirements(
  events: ScheduledEvent[],
  teams: Team[],
  divisionMap: Map<string, Division>,
  configByDivision: Map<string, DivisionConfig>,
  season: Season
): WeeklyRequirementsReport {
  const teamReports: TeamWeeklyReport[] = [];

  // Get date range from season
  const scheduleStart = season.startDate;
  const scheduleEnd = season.endDate;

  // Generate all weeks in the schedule range
  const allWeeks: { start: string; end: string }[] = [];
  let currentWeekStart = getWeekStart(scheduleStart);
  while (currentWeekStart <= scheduleEnd) {
    allWeeks.push({
      start: currentWeekStart,
      end: getWeekEnd(currentWeekStart),
    });
    const nextWeek = new Date(currentWeekStart + 'T00:00:00');
    nextWeek.setDate(nextWeek.getDate() + 7);
    currentWeekStart = nextWeek.toISOString().split('T')[0];
  }

  // Generate game weeks to map week dates to game week numbers
  const gameWeeks = generateGameWeeks(season);

  for (const team of teams) {
    const division = divisionMap.get(team.divisionId);
    const config = configByDivision.get(team.divisionId);

    if (!division || !config) continue;

    // Filter events for this team
    // Note: paired_practice events use team1Id/team2Id instead of teamId
    const teamEvents = events.filter(
      (e) =>
        e.teamId === team.id ||
        e.homeTeamId === team.id ||
        e.awayTeamId === team.id ||
        e.team1Id === team.id ||
        e.team2Id === team.id
    );

    const issues: string[] = [];
    const weeks: WeekSummary[] = [];

    for (const week of allWeeks) {
      const weekEvents = teamEvents.filter(
        (e) => e.date >= week.start && e.date <= week.end
      );

      const gamesScheduled = weekEvents.filter((e) => e.eventType === 'game').length;
      // paired_practice counts as both a practice AND a cage session
      const practicesScheduled = weekEvents.filter(
        (e) => e.eventType === 'practice' || e.eventType === 'paired_practice'
      ).length;
      const cagesScheduled = weekEvents.filter(
        (e) => e.eventType === 'cage' || e.eventType === 'paired_practice'
      ).length;

      // Determine which event types are allowed for this week based on season
      const allowedTypes = getAllowedEventTypesForWeek(week.start, week.end, season);

      // Find the game week number for this week (if it's a game week)
      const gameWeek = gameWeeks.find(gw => gw.start === week.start);
      const gameWeekNumber = gameWeek?.weekNumber;

      // Only require events that are allowed in this week's periods
      // Use game week override if available
      let gamesRequired = 0;
      if (allowedTypes.has('game') && gameWeekNumber !== undefined) {
        gamesRequired = getGamesPerWeekForDivision(config, gameWeekNumber);
      }
      const practicesRequired = allowedTypes.has('practice') ? config.practicesPerWeek : 0;
      const cagesRequired = allowedTypes.has('cage') ? (config.cageSessionsPerWeek || 0) : 0;

      // Check for issues
      if (gamesScheduled < gamesRequired) {
        issues.push(
          `Week of ${week.start}: ${gamesScheduled} games (required: ${gamesRequired})`
        );
      }
      if (practicesScheduled < practicesRequired) {
        issues.push(
          `Week of ${week.start}: ${practicesScheduled} practices (required: ${practicesRequired})`
        );
      }
      if (cagesRequired > 0 && cagesScheduled < cagesRequired) {
        issues.push(
          `Week of ${week.start}: ${cagesScheduled} cage sessions (required: ${cagesRequired})`
        );
      }

      weeks.push({
        weekStart: week.start,
        weekEnd: week.end,
        gamesScheduled,
        gamesRequired,
        practicesScheduled,
        practicesRequired,
        cagesScheduled,
        cagesRequired,
      });
    }

    teamReports.push({
      teamId: team.id,
      teamName: team.name,
      divisionId: team.divisionId,
      divisionName: division.name,
      weeks,
      issues,
      passed: issues.length === 0,
    });
  }

  const allPassed = teamReports.every((r) => r.passed);
  const totalIssues = teamReports.reduce((sum, r) => sum + r.issues.length, 0);

  return {
    passed: allPassed,
    summary: allPassed
      ? 'All teams meeting weekly requirements'
      : `${totalIssues} weekly requirement issues found`,
    teamReports,
  };
}

/**
 * Evaluate home/away balance for all teams
 */
function evaluateHomeAwayBalance(
  events: ScheduledEvent[],
  teams: Team[],
  divisionMap: Map<string, Division>
): HomeAwayBalanceReport {
  const teamReports: TeamHomeAwayReport[] = [];
  const BALANCE_THRESHOLD = 1; // Allow ±1 game difference

  for (const team of teams) {
    const division = divisionMap.get(team.divisionId);
    if (!division) continue;

    const games = events.filter(
      (e) =>
        e.eventType === 'game' &&
        (e.homeTeamId === team.id || e.awayTeamId === team.id)
    );

    const homeGames = games.filter((e) => e.homeTeamId === team.id).length;
    const awayGames = games.filter((e) => e.awayTeamId === team.id).length;
    const totalGames = homeGames + awayGames;
    const balance = Math.abs(homeGames - awayGames);
    const passed = balance <= BALANCE_THRESHOLD;

    teamReports.push({
      teamId: team.id,
      teamName: team.name,
      divisionId: team.divisionId,
      divisionName: division.name,
      homeGames,
      awayGames,
      totalGames,
      balance,
      passed,
    });
  }

  const allPassed = teamReports.every((r) => r.passed);
  const imbalancedTeams = teamReports.filter((r) => !r.passed).length;

  return {
    passed: allPassed,
    summary: allPassed
      ? `All teams within ±${BALANCE_THRESHOLD} game balance`
      : `${imbalancedTeams} teams with home/away imbalance`,
    teamReports,
  };
}

/**
 * Evaluate constraint violations
 */
function evaluateConstraintViolations(
  events: ScheduledEvent[],
  teamMap: Map<string, Team>,
  divisionMap: Map<string, Division>,
  configByDivision: Map<string, DivisionConfig>,
  season: Season
): ConstraintViolationsReport {
  const violations: ConstraintViolation[] = [];

  // Group events by team and date
  const eventsByTeamDate = new Map<string, ScheduledEvent[]>();

  for (const event of events) {
    const teamIds: string[] = [];
    if (event.teamId) teamIds.push(event.teamId);
    if (event.homeTeamId) teamIds.push(event.homeTeamId);
    if (event.awayTeamId) teamIds.push(event.awayTeamId);

    for (const teamId of teamIds) {
      const key = `${teamId}-${event.date}`;
      const existing = eventsByTeamDate.get(key) || [];
      existing.push(event);
      eventsByTeamDate.set(key, existing);
    }
  }

  // Check same-day conflicts
  for (const [key, dayEvents] of eventsByTeamDate) {
    if (dayEvents.length > 1) {
      // Allow field + cage on same day, but flag other combinations
      const fieldEvents = dayEvents.filter((e) => e.fieldId);
      const cageEvents = dayEvents.filter((e) => e.cageId && !e.fieldId);

      if (fieldEvents.length > 1) {
        const [teamId, date] = key.split('-');
        const team = teamMap.get(teamId);
        const division = team ? divisionMap.get(team.divisionId) : undefined;

        violations.push({
          type: 'same_day_conflict',
          severity: 'warning',
          teamId,
          teamName: team?.name,
          divisionId: team?.divisionId,
          divisionName: division?.name,
          date,
          description: `${fieldEvents.length} field events on same day`,
          eventIds: fieldEvents.map((e) => e.id),
        });
      }
    }
  }

  // Check min day gap violations
  const eventsByTeam = new Map<string, ScheduledEvent[]>();
  for (const event of events) {
    const teamIds: string[] = [];
    if (event.teamId) teamIds.push(event.teamId);
    if (event.homeTeamId) teamIds.push(event.homeTeamId);
    if (event.awayTeamId) teamIds.push(event.awayTeamId);

    for (const teamId of teamIds) {
      const existing = eventsByTeam.get(teamId) || [];
      existing.push(event);
      eventsByTeam.set(teamId, existing);
    }
  }

  for (const [teamId, teamEvents] of eventsByTeam) {
    const team = teamMap.get(teamId);
    if (!team) continue;

    const config = configByDivision.get(team.divisionId);
    const minGap = config?.minConsecutiveDayGap || 0;

    if (minGap <= 0) continue;

    // Sort by date
    const sortedEvents = [...teamEvents].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const current = sortedEvents[i];
      const next = sortedEvents[i + 1];

      const currentDate = new Date(current.date + 'T00:00:00');
      const nextDate = new Date(next.date + 'T00:00:00');
      const daysDiff = Math.floor(
        (nextDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff > 0 && daysDiff < minGap) {
        const division = divisionMap.get(team.divisionId);
        violations.push({
          type: 'min_day_gap',
          severity: 'warning',
          teamId,
          teamName: team.name,
          divisionId: team.divisionId,
          divisionName: division?.name,
          date: next.date,
          description: `Only ${daysDiff} day(s) between events (min: ${minGap})`,
          eventIds: [current.id, next.id],
        });
      }
    }
  }

  // Check resource conflicts (same field/cage at overlapping times)
  const eventsByResourceDate = new Map<string, ScheduledEvent[]>();
  for (const event of events) {
    const resourceId = event.fieldId || event.cageId;
    if (!resourceId) continue;

    const key = `${resourceId}-${event.date}`;
    const existing = eventsByResourceDate.get(key) || [];
    existing.push(event);
    eventsByResourceDate.set(key, existing);
  }

  for (const [, resourceEvents] of eventsByResourceDate) {
    if (resourceEvents.length <= 1) continue;

    // Sort by start time
    const sorted = [...resourceEvents].sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      // Check for time overlap
      if (current.endTime > next.startTime) {
        violations.push({
          type: 'resource_conflict',
          severity: 'error',
          date: current.date,
          description: `Resource time overlap: ${current.startTime}-${current.endTime} overlaps with ${next.startTime}-${next.endTime}`,
          eventIds: [current.id, next.id],
        });
      }
    }
  }

  // Check if games are scheduled before gamesStartDate
  const gamesStartDate = season.gamesStartDate || season.startDate;
  for (const event of events) {
    if (event.eventType === 'game' && event.date < gamesStartDate) {
      const team = event.homeTeamId
        ? teamMap.get(event.homeTeamId)
        : undefined;
      const division = team ? divisionMap.get(team.divisionId) : undefined;

      violations.push({
        type: 'invalid_event_type_for_period',
        severity: 'error',
        teamId: team?.id,
        teamName: team?.name,
        divisionId: division?.id,
        divisionName: division?.name,
        date: event.date,
        description: `Game scheduled on ${event.date} but games are only allowed from ${gamesStartDate}`,
        eventIds: [event.id],
      });
    }
  }

  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;

  return {
    passed: errorCount === 0,
    summary:
      violations.length === 0
        ? 'No constraint violations found'
        : `${errorCount} errors, ${warningCount} warnings`,
    violations,
  };
}

/**
 * Evaluate game day preferences
 */
function evaluateGameDayPreferences(
  events: ScheduledEvent[],
  teams: Team[],
  divisionMap: Map<string, Division>,
  configByDivision: Map<string, DivisionConfig>
): GameDayPreferencesReport {
  const divisionReports: DivisionGameDayReport[] = [];

  // Get unique division IDs from events
  const divisionIds = new Set(events.map((e) => e.divisionId));

  for (const divisionId of divisionIds) {
    const division = divisionMap.get(divisionId);
    const config = configByDivision.get(divisionId);

    if (!division) continue;

    const preferences = config?.gameDayPreferences || [];
    const divisionGames = events.filter(
      (e) => e.divisionId === divisionId && e.eventType === 'game'
    );
    const divisionTeams = teams.filter((t) => t.divisionId === divisionId);

    // Count games by day of week (total for division)
    const actualDistribution: Record<number, number> = {};
    for (let i = 0; i < 7; i++) {
      actualDistribution[i] = 0;
    }

    for (const game of divisionGames) {
      const date = new Date(game.date + 'T00:00:00');
      const dayOfWeek = date.getDay();
      actualDistribution[dayOfWeek]++;
    }

    // Calculate per-team distributions
    const teamDistributions: TeamGameDayDistribution[] = [];
    for (const team of divisionTeams) {
      const distribution: Record<number, number> = {};
      for (let i = 0; i < 7; i++) {
        distribution[i] = 0;
      }

      // Find games where this team participates
      const teamGames = divisionGames.filter(
        (g) => g.homeTeamId === team.id || g.awayTeamId === team.id
      );

      for (const game of teamGames) {
        const date = new Date(game.date + 'T00:00:00');
        const dayOfWeek = date.getDay();
        distribution[dayOfWeek]++;
      }

      teamDistributions.push({
        teamId: team.id,
        teamName: team.name,
        distribution,
        totalGames: teamGames.length,
      });
    }

    // Sort teams by name for consistent display
    teamDistributions.sort((a, b) => a.teamName.localeCompare(b.teamName));

    const issues: string[] = [];
    let totalGames = divisionGames.length;
    let compliantGames = 0;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const pref of preferences) {
      const gamesOnDay = actualDistribution[pref.dayOfWeek];

      if (pref.priority === 'required' && gamesOnDay === 0) {
        issues.push(`No games on ${dayNames[pref.dayOfWeek]} (required)`);
      } else if (pref.priority === 'avoid' && gamesOnDay > 0) {
        issues.push(`${gamesOnDay} games on ${dayNames[pref.dayOfWeek]} (should avoid)`);
      } else if (pref.maxGamesPerDay && gamesOnDay > pref.maxGamesPerDay) {
        issues.push(
          `${gamesOnDay} games on ${dayNames[pref.dayOfWeek]} (max: ${pref.maxGamesPerDay})`
        );
      }

      // Count compliant games
      if (pref.priority === 'required' || pref.priority === 'preferred') {
        compliantGames += gamesOnDay;
      } else if (pref.priority === 'acceptable') {
        compliantGames += gamesOnDay * 0.5; // Partial credit
      }
    }

    // If no preferences set, consider all games compliant
    const complianceRate =
      preferences.length === 0
        ? 100
        : totalGames > 0
          ? Math.round((compliantGames / totalGames) * 100)
          : 100;

    divisionReports.push({
      divisionId,
      divisionName: division.name,
      preferences,
      actualDistribution,
      teamDistributions,
      issues,
      complianceRate,
      passed: issues.length === 0 && complianceRate >= 70,
    });
  }

  const allPassed = divisionReports.every((r) => r.passed);
  const avgCompliance =
    divisionReports.length > 0
      ? Math.round(
          divisionReports.reduce((sum, r) => sum + r.complianceRate, 0) /
            divisionReports.length
        )
      : 100;

  return {
    passed: allPassed,
    summary: allPassed
      ? `All divisions compliant (avg: ${avgCompliance}%)`
      : `Game day preference issues found (avg compliance: ${avgCompliance}%)`,
    divisionReports,
  };
}

/**
 * Evaluate game spacing - average days between games for each team
 * Evaluates fairness: all teams should have similar average spacing
 */
function evaluateGameSpacing(
  events: ScheduledEvent[],
  teams: Team[],
  divisionMap: Map<string, Division>
): GameSpacingReport {
  const teamReports: TeamGameSpacingReport[] = [];
  const MAX_DEVIATION_FROM_AVG = 1.5; // Max allowed deviation from overall average (in days)

  for (const team of teams) {
    const division = divisionMap.get(team.divisionId);
    if (!division) continue;

    // Get all games for this team, sorted by date
    const teamGames = events
      .filter(
        (e) =>
          e.eventType === 'game' &&
          (e.homeTeamId === team.id || e.awayTeamId === team.id)
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    if (teamGames.length < 2) {
      // Not enough games to calculate spacing
      teamReports.push({
        teamId: team.id,
        teamName: team.name,
        divisionId: team.divisionId,
        divisionName: division.name,
        totalGames: teamGames.length,
        averageDaysBetweenGames: 0,
        minDaysBetweenGames: 0,
        maxDaysBetweenGames: 0,
        gameGaps: [],
        passed: true, // Can't fail with < 2 games
      });
      continue;
    }

    // Calculate gaps between consecutive games
    const gameGaps: number[] = [];
    for (let i = 0; i < teamGames.length - 1; i++) {
      const currentDate = new Date(teamGames[i].date + 'T12:00:00');
      const nextDate = new Date(teamGames[i + 1].date + 'T12:00:00');
      const daysDiff = Math.round(
        (nextDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      gameGaps.push(daysDiff);
    }

    const avgDays = gameGaps.reduce((sum, gap) => sum + gap, 0) / gameGaps.length;
    const minDays = Math.min(...gameGaps);
    const maxDays = Math.max(...gameGaps);

    teamReports.push({
      teamId: team.id,
      teamName: team.name,
      divisionId: team.divisionId,
      divisionName: division.name,
      totalGames: teamGames.length,
      averageDaysBetweenGames: Math.round(avgDays * 10) / 10, // Round to 1 decimal
      minDaysBetweenGames: minDays,
      maxDaysBetweenGames: maxDays,
      gameGaps,
      passed: true, // Will be updated after calculating overall average
    });
  }

  // Calculate average per division (not global) since divisions have different games per week
  const divisionAverages = new Map<string, number>();
  const teamsWithGames = teamReports.filter((r) => r.totalGames >= 2);

  // Group by division and calculate per-division average
  const byDivision = new Map<string, TeamGameSpacingReport[]>();
  for (const report of teamsWithGames) {
    const existing = byDivision.get(report.divisionId) || [];
    existing.push(report);
    byDivision.set(report.divisionId, existing);
  }

  for (const [divisionId, divisionReports] of byDivision) {
    const avg = divisionReports.reduce((sum, r) => sum + r.averageDaysBetweenGames, 0) / divisionReports.length;
    divisionAverages.set(divisionId, avg);
  }

  // Now check each team's deviation from their division's average
  for (const report of teamReports) {
    if (report.totalGames < 2) continue;
    const divisionAvg = divisionAverages.get(report.divisionId) || 0;
    const deviation = Math.abs(report.averageDaysBetweenGames - divisionAvg);
    report.passed = deviation <= MAX_DEVIATION_FROM_AVG;
  }

  const allPassed = teamReports.every((r) => r.passed);
  const failedCount = teamReports.filter((r) => !r.passed).length;

  // Calculate max deviation within each division for summary
  let maxDeviation = 0;
  for (const [divisionId, divisionReports] of byDivision) {
    const divisionAvg = divisionAverages.get(divisionId) || 0;
    for (const report of divisionReports) {
      const deviation = Math.abs(report.averageDaysBetweenGames - divisionAvg);
      maxDeviation = Math.max(maxDeviation, deviation);
    }
  }

  // Calculate overall average for display purposes only
  const overallAvg = teamsWithGames.length > 0
    ? teamsWithGames.reduce((sum, r) => sum + r.averageDaysBetweenGames, 0) / teamsWithGames.length
    : 0;

  return {
    passed: allPassed,
    summary: allPassed
      ? `Game spacing is fair within divisions (max deviation: ${maxDeviation.toFixed(1)} days)`
      : `${failedCount} teams with uneven game spacing within their division (max deviation: ${maxDeviation.toFixed(1)} days)`,
    teamReports,
    overallAverageDaysBetweenGames: Math.round(overallAvg * 10) / 10,
  };
}

/**
 * Evaluate matchup balance - how many times each team plays each other team
 */
function evaluateMatchupBalance(
  events: ScheduledEvent[],
  teams: Team[],
  divisionMap: Map<string, Division>,
  configByDivision: Map<string, DivisionConfig>,
  season: Season
): MatchupBalanceReport {
  const divisionReports: DivisionMatchupReport[] = [];
  const IMBALANCE_THRESHOLD = 2; // Allow up to 2 games difference from ideal

  // Get unique divisions
  const divisionIds = new Set(teams.map((t) => t.divisionId));

  for (const divisionId of divisionIds) {
    const division = divisionMap.get(divisionId);
    const config = configByDivision.get(divisionId);
    if (!division) continue;

    const divisionTeams = teams.filter((t) => t.divisionId === divisionId);
    const divisionGames = events.filter(
      (e) => e.divisionId === divisionId && e.eventType === 'game'
    );

    // Calculate ideal games per matchup
    // Total games per team = sum of games per week (accounting for overrides)
    // Number of opponents = (teamCount - 1)
    // Ideal games per matchup = (totalGamesPerTeam) / numberOfOpponents
    const teamCount = divisionTeams.length;
    if (teamCount < 2) continue;

    // Calculate total games per team by summing each game week's requirement
    const gameWeeks = generateGameWeeks(season);
    let totalGamesPerTeam = 0;
    if (config) {
      for (let i = 0; i < gameWeeks.length; i++) {
        totalGamesPerTeam += getGamesPerWeekForDivision(config, i + 1);
      }
    } else {
      // Fallback if no config
      totalGamesPerTeam = 2 * gameWeeks.length;
    }

    const numberOfOpponents = teamCount - 1;
    const idealGamesPerMatchup = totalGamesPerTeam / numberOfOpponents;

    // Build matchup counts for each team
    const teamMatchups: TeamMatchupReport[] = [];
    let maxImbalance = 0;

    for (const team of divisionTeams) {
      const opponents: OpponentMatchup[] = [];

      for (const opponent of divisionTeams) {
        if (opponent.id === team.id) continue;

        // Count games between these two teams
        const matchupGames = divisionGames.filter(
          (g) =>
            (g.homeTeamId === team.id && g.awayTeamId === opponent.id) ||
            (g.homeTeamId === opponent.id && g.awayTeamId === team.id)
        );

        const homeGames = matchupGames.filter((g) => g.homeTeamId === team.id).length;
        const awayGames = matchupGames.filter((g) => g.awayTeamId === team.id).length;
        const gamesPlayed = homeGames + awayGames;

        // Track imbalance from ideal
        const imbalance = Math.abs(gamesPlayed - idealGamesPerMatchup);
        maxImbalance = Math.max(maxImbalance, imbalance);

        opponents.push({
          opponentId: opponent.id,
          opponentName: opponent.name,
          gamesPlayed,
          homeGames,
          awayGames,
        });
      }

      // Sort opponents by name for consistent display
      opponents.sort((a, b) => a.opponentName.localeCompare(b.opponentName));

      // Count total games for this team
      const totalGames = divisionGames.filter(
        (g) => g.homeTeamId === team.id || g.awayTeamId === team.id
      ).length;

      teamMatchups.push({
        teamId: team.id,
        teamName: team.name,
        opponents,
        totalGames,
      });
    }

    // Sort teams by name for consistent display
    teamMatchups.sort((a, b) => a.teamName.localeCompare(b.teamName));

    divisionReports.push({
      divisionId,
      divisionName: division.name,
      teamMatchups,
      idealGamesPerMatchup: Math.round(idealGamesPerMatchup * 10) / 10,
      maxImbalance: Math.round(maxImbalance * 10) / 10,
      passed: maxImbalance <= IMBALANCE_THRESHOLD,
    });
  }

  const allPassed = divisionReports.every((r) => r.passed);
  const maxOverallImbalance = divisionReports.length > 0
    ? Math.max(...divisionReports.map((r) => r.maxImbalance))
    : 0;

  return {
    passed: allPassed,
    summary: allPassed
      ? `All matchups balanced (max imbalance: ${maxOverallImbalance})`
      : `Matchup imbalance detected (max: ${maxOverallImbalance} games from ideal)`,
    divisionReports,
  };
}

/**
 * Check if two time ranges overlap
 * Times are in HH:MM format
 */
function timesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  // Two ranges overlap if: start1 < end2 AND end1 > start2
  return start1 < end2 && end1 > start2;
}

/**
 * Evaluate game slot efficiency - tracks games that have no concurrent games running
 * This helps assess how efficiently the snack shack and facilities are being used
 */
function evaluateGameSlotEfficiency(
  events: ScheduledEvent[],
  teamMap: Map<string, Team>,
  divisionMap: Map<string, Division>,
  fieldMap: Map<string, SeasonField>
): GameSlotEfficiencyReport {
  // Filter to only games
  const games = events.filter((e) => e.eventType === 'game');

  if (games.length === 0) {
    return {
      passed: true,
      summary: 'No games scheduled',
      totalGameSlots: 0,
      isolatedSlots: 0,
      concurrentSlots: 0,
      efficiencyRate: 100,
      isolatedSlotDetails: [],
    };
  }

  // Group games by date
  const gamesByDate = new Map<string, ScheduledEvent[]>();
  for (const game of games) {
    const existing = gamesByDate.get(game.date) || [];
    existing.push(game);
    gamesByDate.set(game.date, existing);
  }

  let isolatedGames = 0;
  let concurrentGames = 0;
  const isolatedSlotDetails: IsolatedGameSlot[] = [];

  // For each game, check if any other game on the same day overlaps with it
  for (const game of games) {
    const sameDay = gamesByDate.get(game.date) || [];

    // Check if this game overlaps with any other game on the same day
    const hasOverlap = sameDay.some((other) => {
      if (other.id === game.id) return false; // Skip self
      return timesOverlap(game.startTime, game.endTime, other.startTime, other.endTime);
    });

    if (hasOverlap) {
      concurrentGames++;
    } else {
      isolatedGames++;

      // Look up names for the isolated game details
      const homeTeam = game.homeTeamId ? teamMap.get(game.homeTeamId) : undefined;
      const awayTeam = game.awayTeamId ? teamMap.get(game.awayTeamId) : undefined;
      const division = divisionMap.get(game.divisionId);
      const field = game.fieldId ? fieldMap.get(game.fieldId) : undefined;

      isolatedSlotDetails.push({
        date: game.date,
        startTime: game.startTime,
        endTime: game.endTime,
        fieldId: game.fieldId || '',
        fieldName: field?.fieldName || 'Unknown Field',
        homeTeamName: homeTeam?.name || 'Unknown',
        awayTeamName: awayTeam?.name || 'Unknown',
        divisionName: division?.name || 'Unknown Division',
      });
    }
  }

  const totalGames = games.length;

  // Calculate efficiency rate (percentage of games that have concurrent games)
  const efficiencyRate = totalGames > 0
    ? Math.round((concurrentGames / totalGames) * 100)
    : 100;

  // Sort isolated slot details by date and time for easier reading
  isolatedSlotDetails.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.startTime.localeCompare(b.startTime);
  });

  // Consider "passed" if efficiency rate is >= 70% (at most 30% isolated games)
  const passed = efficiencyRate >= 70;

  return {
    passed,
    summary: passed
      ? `${efficiencyRate}% of games have concurrent games (${isolatedGames} isolated)`
      : `Only ${efficiencyRate}% of games have concurrent games (${isolatedGames} isolated)`,
    totalGameSlots: totalGames,
    isolatedSlots: isolatedGames,
    concurrentSlots: concurrentGames,
    efficiencyRate,
    isolatedSlotDetails,
  };
}
