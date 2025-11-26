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
  GameSpacingReport,
  TeamGameSpacingReport,
  ScheduledEvent,
  Team,
  Division,
  DivisionConfig,
  SeasonPeriod,
  GameDayPreference,
} from '@ll-scheduler/shared';
import { listScheduledEvents } from './scheduled-events.js';
import { getSeasonPeriodsByIds } from './season-periods.js';
import { listTeams } from './teams.js';
import { listDivisions } from './divisions.js';
import { listDivisionConfigsBySeasonId } from './division-configs.js';

/**
 * Main evaluation function that runs all checks on a schedule
 */
export async function evaluateSchedule(
  db: D1Database,
  periodIds: string[]
): Promise<ScheduleEvaluationResult> {
  // Fetch all required data
  const periods = await getSeasonPeriodsByIds(db, periodIds);
  if (periods.length === 0) {
    throw new Error('No valid season periods found');
  }

  // All periods should be from the same season
  const seasonId = periods[0].seasonId;

  const [events, teams, divisions, divisionConfigs] = await Promise.all([
    listScheduledEvents(db, { seasonPeriodIds: periodIds }),
    listTeams(db, seasonId),
    listDivisions(db),
    listDivisionConfigsBySeasonId(db, seasonId),
  ]);

  // Create lookup maps
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const divisionMap = new Map(divisions.map((d) => [d.id, d]));
  const configByDivision = new Map(divisionConfigs.map((c) => [c.divisionId, c]));
  const periodMap = new Map(periods.map((p) => [p.id, p]));

  // Run all evaluations
  const weeklyRequirements = evaluateWeeklyRequirements(
    events,
    teams,
    divisionMap,
    configByDivision,
    periods
  );
  const homeAwayBalance = evaluateHomeAwayBalance(events, teams, divisionMap);
  const constraintViolations = evaluateConstraintViolations(
    events,
    teamMap,
    divisionMap,
    configByDivision,
    periodMap
  );
  const gameDayPreferences = evaluateGameDayPreferences(
    events,
    divisionMap,
    configByDivision
  );
  const gameSpacing = evaluateGameSpacing(events, teams, divisionMap);

  // Calculate overall score
  const checks = [
    weeklyRequirements.passed,
    homeAwayBalance.passed,
    constraintViolations.passed,
    gameDayPreferences.passed,
    gameSpacing.passed,
  ];
  const passedCount = checks.filter(Boolean).length;
  const overallScore = Math.round((passedCount / checks.length) * 100);

  return {
    overallScore,
    timestamp: new Date().toISOString(),
    periodIds,
    weeklyRequirements,
    homeAwayBalance,
    constraintViolations,
    gameDayPreferences,
    gameSpacing,
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
 * Get allowed event types for a week based on overlapping periods
 */
function getAllowedEventTypesForWeek(
  weekStart: string,
  weekEnd: string,
  periods: SeasonPeriod[]
): Set<string> {
  const allowed = new Set<string>();

  for (const period of periods) {
    // Check if period overlaps with this week
    if (period.startDate <= weekEnd && period.endDate >= weekStart) {
      for (const eventType of period.eventTypes) {
        allowed.add(eventType);
      }
    }
  }

  return allowed;
}

/**
 * Evaluate weekly requirements for all teams
 */
function evaluateWeeklyRequirements(
  events: ScheduledEvent[],
  teams: Team[],
  divisionMap: Map<string, Division>,
  configByDivision: Map<string, DivisionConfig>,
  periods: SeasonPeriod[]
): WeeklyRequirementsReport {
  const teamReports: TeamWeeklyReport[] = [];

  // Get date range from periods
  const startDates = periods.map((p) => p.startDate).sort();
  const endDates = periods.map((p) => p.endDate).sort().reverse();
  const scheduleStart = startDates[0];
  const scheduleEnd = endDates[0];

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

  for (const team of teams) {
    const division = divisionMap.get(team.divisionId);
    const config = configByDivision.get(team.divisionId);

    if (!division || !config) continue;

    // Filter events for this team
    const teamEvents = events.filter(
      (e) =>
        e.teamId === team.id ||
        e.homeTeamId === team.id ||
        e.awayTeamId === team.id
    );

    const issues: string[] = [];
    const weeks: WeekSummary[] = [];

    for (const week of allWeeks) {
      const weekEvents = teamEvents.filter(
        (e) => e.date >= week.start && e.date <= week.end
      );

      const gamesScheduled = weekEvents.filter((e) => e.eventType === 'game').length;
      const practicesScheduled = weekEvents.filter((e) => e.eventType === 'practice').length;
      const cagesScheduled = weekEvents.filter((e) => e.eventType === 'cage').length;

      // Determine which event types are allowed for this week based on periods
      const allowedTypes = getAllowedEventTypesForWeek(week.start, week.end, periods);

      // Only require events that are allowed in this week's periods
      const gamesRequired = allowedTypes.has('game') ? config.gamesPerWeek : 0;
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
  periodMap: Map<string, SeasonPeriod>
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

  // Check invalid event types for periods
  for (const event of events) {
    const period = periodMap.get(event.seasonPeriodId);
    if (period && !period.eventTypes.includes(event.eventType)) {
      const team = event.teamId
        ? teamMap.get(event.teamId)
        : event.homeTeamId
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
        description: `${event.eventType} event not allowed in period "${period.name}" (allowed: ${period.eventTypes.join(', ')})`,
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

    // Count games by day of week
    const actualDistribution: Record<number, number> = {};
    for (let i = 0; i < 7; i++) {
      actualDistribution[i] = 0;
    }

    for (const game of divisionGames) {
      const date = new Date(game.date + 'T00:00:00');
      const dayOfWeek = date.getDay();
      actualDistribution[dayOfWeek]++;
    }

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
 */
function evaluateGameSpacing(
  events: ScheduledEvent[],
  teams: Team[],
  divisionMap: Map<string, Division>
): GameSpacingReport {
  const teamReports: TeamGameSpacingReport[] = [];
  const MIN_ACCEPTABLE_AVG_DAYS = 5; // Minimum acceptable average days between games

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
      passed: avgDays >= MIN_ACCEPTABLE_AVG_DAYS,
    });
  }

  // Calculate overall average
  const teamsWithGames = teamReports.filter((r) => r.totalGames >= 2);
  const overallAvg =
    teamsWithGames.length > 0
      ? teamsWithGames.reduce((sum, r) => sum + r.averageDaysBetweenGames, 0) /
        teamsWithGames.length
      : 0;

  const allPassed = teamReports.every((r) => r.passed);
  const failedCount = teamReports.filter((r) => !r.passed).length;

  return {
    passed: allPassed,
    summary: allPassed
      ? `All teams have adequate game spacing (avg: ${overallAvg.toFixed(1)} days)`
      : `${failedCount} teams with insufficient game spacing (avg: ${overallAvg.toFixed(1)} days)`,
    teamReports,
    overallAverageDaysBetweenGames: Math.round(overallAvg * 10) / 10,
  };
}
