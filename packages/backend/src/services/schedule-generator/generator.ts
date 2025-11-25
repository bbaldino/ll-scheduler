import type {
  GenerateScheduleRequest,
  GenerateScheduleResult,
  ScheduledEventDraft,
  TimeSlot,
  ResourceSlot,
  TeamConstraint,
  GameMatchup,
  ScheduleError,
  ScheduleWarning,
  SchedulingLogEntry,
  SeasonPeriod,
  Season,
  DivisionConfig,
  Team,
  SeasonField,
  SeasonCage,
  FieldAvailability,
  CageAvailability,
  FieldDateOverride,
  CageDateOverride,
  EventType,
} from '@ll-scheduler/shared';
import {
  getDateRange,
  getDayOfWeek,
  calculateDuration,
  hasTimeConflict,
  areTeamsAvailableForMatchup,
  isTeamAvailable,
  countTeamEvents,
  slotHasRequiredDuration,
  timeToMinutes,
  minutesToTime,
} from './constraints.js';

/**
 * Main schedule generator
 * Generates optimal schedules for games, practices, and cage sessions
 * Now supports multiple overlapping SeasonPeriods with different event types
 */
export class ScheduleGenerator {
  private periods: SeasonPeriod[];
  private season: Season;
  private divisionConfigs: Map<string, DivisionConfig>;
  private teams: Team[];
  private seasonFields: SeasonField[];
  private seasonCages: SeasonCage[];
  private fieldAvailability: FieldAvailability[];
  private cageAvailability: CageAvailability[];
  private fieldOverrides: FieldDateOverride[];
  private cageOverrides: CageDateOverride[];

  // Lookup maps for season field/cage ID to global field/cage ID
  private seasonFieldToFieldId: Map<string, string> = new Map();
  private seasonCageToCageId: Map<string, string> = new Map();

  // Division compatibility lookup: fieldId -> array of compatible division IDs (empty = all divisions)
  private fieldDivisionCompatibility: Map<string, string[]> = new Map();
  private cageDivisionCompatibility: Map<string, string[]> = new Map();

  // Date -> allowed event types mapping (built from overlapping periods)
  private dateEventTypes: Map<string, { eventTypes: Set<EventType>; periodId: string }[]> = new Map();

  // Resource slots (built once across all periods)
  private gameFieldSlots: ResourceSlot[] = [];
  private practiceFieldSlots: ResourceSlot[] = [];
  private cageSlots: ResourceSlot[] = [];

  private teamConstraints: Map<string, TeamConstraint> = new Map();
  private scheduledEvents: ScheduledEventDraft[] = [];
  private errors: ScheduleError[] = [];
  private warnings: ScheduleWarning[] = [];
  private schedulingLog: SchedulingLogEntry[] = [];

  // Day names for logging
  private static readonly DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  constructor(
    periods: SeasonPeriod[],
    season: Season,
    divisionConfigs: DivisionConfig[],
    teams: Team[],
    seasonFields: SeasonField[],
    seasonCages: SeasonCage[],
    fieldAvailability: FieldAvailability[],
    cageAvailability: CageAvailability[],
    fieldOverrides: FieldDateOverride[],
    cageOverrides: CageDateOverride[]
  ) {
    this.periods = periods;
    this.season = season;
    this.divisionConfigs = new Map(divisionConfigs.map((dc) => [dc.divisionId, dc]));
    this.teams = teams;
    this.seasonFields = seasonFields;
    this.seasonCages = seasonCages;
    this.fieldAvailability = fieldAvailability;
    this.cageAvailability = cageAvailability;
    this.fieldOverrides = fieldOverrides;
    this.cageOverrides = cageOverrides;

    // Build lookup maps
    for (const sf of seasonFields) {
      this.seasonFieldToFieldId.set(sf.id, sf.fieldId);
      // Store division compatibility (from the joined Field data)
      this.fieldDivisionCompatibility.set(sf.fieldId, sf.divisionCompatibility || []);
    }
    for (const sc of seasonCages) {
      this.seasonCageToCageId.set(sc.id, sc.cageId);
      // Store division compatibility (from the joined Cage data)
      this.cageDivisionCompatibility.set(sc.cageId, sc.divisionCompatibility || []);
    }

    // Build date -> event types mapping from overlapping periods
    this.buildDateEventTypesMap();
  }

  /**
   * Build a map of date -> allowed event types from all selected periods
   * This handles overlapping periods correctly
   */
  private buildDateEventTypesMap(): void {
    for (const period of this.periods) {
      const dates = getDateRange(period.startDate, period.endDate);
      for (const date of dates) {
        if (!this.dateEventTypes.has(date)) {
          this.dateEventTypes.set(date, []);
        }
        this.dateEventTypes.get(date)!.push({
          eventTypes: new Set(period.eventTypes),
          periodId: period.id,
        });
      }
    }
  }

  /**
   * Add an entry to the scheduling log
   */
  private log(
    level: SchedulingLogEntry['level'],
    category: SchedulingLogEntry['category'],
    message: string,
    details?: SchedulingLogEntry['details']
  ): void {
    this.schedulingLog.push({
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      details,
    });
    // Also console.log for server-side debugging
    const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
    console.log(`[${level.toUpperCase()}] [${category}] ${message}${detailsStr}`);
  }

  /**
   * Check if an event type is allowed on a specific date
   * Returns the period ID to use for scheduling, or null if not allowed
   */
  private getEventTypeAllowedOnDate(date: string, eventType: EventType): string | null {
    const dateInfo = this.dateEventTypes.get(date);
    if (!dateInfo) return null;

    for (const info of dateInfo) {
      if (info.eventTypes.has(eventType)) {
        return info.periodId;
      }
    }
    return null;
  }

  /**
   * Get the merged date range across all periods
   */
  private getMergedDateRange(): { startDate: string; endDate: string } {
    if (this.periods.length === 0) {
      return { startDate: this.season.startDate, endDate: this.season.endDate };
    }

    let minDate = this.periods[0].startDate;
    let maxDate = this.periods[0].endDate;

    for (const period of this.periods) {
      if (period.startDate < minDate) minDate = period.startDate;
      if (period.endDate > maxDate) maxDate = period.endDate;
    }

    return { startDate: minDate, endDate: maxDate };
  }

  /**
   * Generate the schedule
   */
  async generate(): Promise<GenerateScheduleResult> {
    try {
      const dateRange = this.getMergedDateRange();
      console.log('='.repeat(80));
      console.log('SCHEDULE GENERATION STARTED');
      console.log(`Periods: ${this.periods.map(p => `${p.name} (${p.eventTypes.join(', ')})`).join(', ')}`);
      console.log(`Merged date range: ${dateRange.startDate} to ${dateRange.endDate}`);
      console.log(`Season: ${this.season.name} (${this.season.startDate} to ${this.season.endDate})`);
      console.log(`Teams: ${this.teams.length}, Season Fields: ${this.seasonFields.length}, Season Cages: ${this.seasonCages.length}`);
      console.log('Division Configs:', Array.from(this.divisionConfigs.entries()).map(([id, config]) => ({
        divisionId: id,
        gamesPerWeek: config.gamesPerWeek,
        practicesPerWeek: config.practicesPerWeek,
        cageSessionsPerWeek: config.cageSessionsPerWeek,
      })));
      console.log('='.repeat(80));

      // Step 1: Validate prerequisites
      if (!this.validatePrerequisites()) {
        console.log('❌ Validation failed');
        return this.buildResult(false);
      }
      console.log('✓ Prerequisites validated');

      // Step 2: Build available resource slots
      this.buildResourceSlots();
      const totalSlots = this.gameFieldSlots.length + this.practiceFieldSlots.length + this.cageSlots.length;
      console.log(`✓ Built ${totalSlots} resource slots`);
      console.log('Resource slot summary:', {
        gameFields: this.gameFieldSlots.length,
        practiceFields: this.practiceFieldSlots.length,
        cages: this.cageSlots.length,
      });

      // Step 3: Build team constraints
      this.buildTeamConstraints();
      console.log(`✓ Built constraints for ${this.teamConstraints.size} teams`);

      // Step 4: Schedule games
      console.log('\n' + '-'.repeat(80));
      console.log('SCHEDULING GAMES');
      console.log('-'.repeat(80));
      await this.scheduleGames();
      console.log(`✓ Games scheduled: ${this.scheduledEvents.filter(e => e.eventType === 'game').length}`);

      // Step 5: Schedule practices
      console.log('\n' + '-'.repeat(80));
      console.log('SCHEDULING PRACTICES');
      console.log('-'.repeat(80));
      await this.schedulePractices();
      console.log(`✓ Practices scheduled: ${this.scheduledEvents.filter(e => e.eventType === 'practice').length}`);

      // Step 6: Schedule cage sessions
      console.log('\n' + '-'.repeat(80));
      console.log('SCHEDULING CAGE SESSIONS');
      console.log('-'.repeat(80));
      await this.scheduleCageSessions();
      console.log(`✓ Cage sessions scheduled: ${this.scheduledEvents.filter(e => e.eventType === 'cage').length}`);

      console.log('\n' + '='.repeat(80));
      console.log('SCHEDULE GENERATION COMPLETED');
      console.log(`Total events: ${this.scheduledEvents.length}`);
      console.log(`Errors: ${this.errors.length}, Warnings: ${this.warnings.length}`);
      console.log('='.repeat(80));

      return this.buildResult(true);
    } catch (error) {
      console.error('❌ SCHEDULE GENERATION FAILED:', error);
      this.errors.push({
        type: 'generation_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildResult(false);
    }
  }

  /**
   * Validate that we have everything needed to generate a schedule
   */
  private validatePrerequisites(): boolean {
    if (this.teams.length === 0) {
      this.errors.push({
        type: 'no_teams',
        message: 'No teams found for this season phase',
      });
      return false;
    }

    if (this.seasonFields.length === 0) {
      this.errors.push({
        type: 'no_fields',
        message: 'No fields available for scheduling games',
      });
      return false;
    }

    if (this.seasonCages.length === 0) {
      this.errors.push({
        type: 'no_cages',
        message: 'No batting cages available for scheduling cage sessions',
      });
      return false;
    }

    return true;
  }

  /**
   * Build all available resource slots based on overlapping periods
   * Resource slots are built for dates where the event type is allowed
   */
  private buildResourceSlots(): void {
    this.log('info', 'general', 'Building resource slots');

    const dateRange = this.getMergedDateRange();
    const allDates = getDateRange(dateRange.startDate, dateRange.endDate);

    // Build game field slots for dates where games are allowed
    const gameDates = allDates.filter(date => this.getEventTypeAllowedOnDate(date, 'game'));
    this.buildFieldSlotsForDates(gameDates, this.gameFieldSlots);

    // Build practice field slots for dates where practices are allowed
    const practiceDates = allDates.filter(date => this.getEventTypeAllowedOnDate(date, 'practice'));
    this.buildFieldSlotsForDates(practiceDates, this.practiceFieldSlots);

    // Build cage slots for dates where cages are allowed
    const cageDates = allDates.filter(date => this.getEventTypeAllowedOnDate(date, 'cage'));
    this.buildCageSlotsForDates(cageDates);

    // Log summary of slots by day of week
    const slotsByDay: Record<string, { games: number; practices: number; cages: number }> = {};
    for (const slot of this.gameFieldSlots) {
      const dayName = ScheduleGenerator.DAY_NAMES[slot.slot.dayOfWeek];
      if (!slotsByDay[dayName]) slotsByDay[dayName] = { games: 0, practices: 0, cages: 0 };
      slotsByDay[dayName].games++;
    }
    for (const slot of this.practiceFieldSlots) {
      const dayName = ScheduleGenerator.DAY_NAMES[slot.slot.dayOfWeek];
      if (!slotsByDay[dayName]) slotsByDay[dayName] = { games: 0, practices: 0, cages: 0 };
      slotsByDay[dayName].practices++;
    }
    for (const slot of this.cageSlots) {
      const dayName = ScheduleGenerator.DAY_NAMES[slot.slot.dayOfWeek];
      if (!slotsByDay[dayName]) slotsByDay[dayName] = { games: 0, practices: 0, cages: 0 };
      slotsByDay[dayName].cages++;
    }

    this.log('info', 'resource', `Built ${this.gameFieldSlots.length} game slots, ${this.practiceFieldSlots.length} practice slots, ${this.cageSlots.length} cage slots`, {
      slotsByDayOfWeek: slotsByDay,
    });

    // Log detailed slot info per field
    const fieldSlotDetails: Record<string, { dates: string[]; times: string[] }> = {};
    for (const slot of this.gameFieldSlots) {
      const key = slot.resourceName;
      if (!fieldSlotDetails[key]) fieldSlotDetails[key] = { dates: [], times: [] };
      const dayName = ScheduleGenerator.DAY_NAMES[slot.slot.dayOfWeek];
      const info = `${slot.slot.date} (${dayName}) ${slot.slot.startTime}-${slot.slot.endTime}`;
      if (!fieldSlotDetails[key].times.includes(`${dayName}: ${slot.slot.startTime}-${slot.slot.endTime}`)) {
        fieldSlotDetails[key].times.push(`${dayName}: ${slot.slot.startTime}-${slot.slot.endTime}`);
      }
    }
    for (const [fieldName, details] of Object.entries(fieldSlotDetails)) {
      this.log('debug', 'resource', `Field "${fieldName}" availability`, {
        resourceName: fieldName,
        availabilityByDay: details.times,
      });
    }
  }

  /**
   * Build field slots for a given date range
   */
  private buildFieldSlotsForDates(dates: string[], targetSlots: ResourceSlot[]): void {
    for (const date of dates) {
      const dayOfWeek = getDayOfWeek(date);

      for (const seasonField of this.seasonFields) {
        const availability = this.fieldAvailability.filter(
          (a) => a.seasonFieldId === seasonField.id && a.dayOfWeek === dayOfWeek
        );

        for (const avail of availability) {
          const override = this.fieldOverrides.find(
            (o) => o.seasonFieldId === seasonField.id && o.date === date
          );

          if (override?.overrideType === 'blackout') {
            continue;
          }

          const startTime = override?.startTime || avail.startTime;
          const endTime = override?.endTime || avail.endTime;
          const duration = calculateDuration(startTime, endTime);

          targetSlots.push({
            resourceType: 'field',
            resourceId: seasonField.fieldId,
            resourceName: seasonField.field?.name || seasonField.fieldId,
            slot: {
              date,
              dayOfWeek,
              startTime,
              endTime,
              duration,
            },
          });
        }
      }
    }
  }

  /**
   * Build cage slots for a given date range
   */
  private buildCageSlotsForDates(dates: string[]): void {
    for (const date of dates) {
      const dayOfWeek = getDayOfWeek(date);

      for (const seasonCage of this.seasonCages) {
        const availability = this.cageAvailability.filter(
          (a) => a.seasonCageId === seasonCage.id && a.dayOfWeek === dayOfWeek
        );

        for (const avail of availability) {
          const override = this.cageOverrides.find(
            (o) => o.seasonCageId === seasonCage.id && o.date === date
          );

          if (override?.overrideType === 'blackout') {
            continue;
          }

          const startTime = override?.startTime || avail.startTime;
          const endTime = override?.endTime || avail.endTime;
          const duration = calculateDuration(startTime, endTime);

          this.cageSlots.push({
            resourceType: 'cage',
            resourceId: seasonCage.cageId,
            resourceName: seasonCage.cage?.name || seasonCage.cageId,
            slot: {
              date,
              dayOfWeek,
              startTime,
              endTime,
              duration,
            },
          });
        }
      }
    }
  }

  /**
   * Build team constraints based on division configs
   * Calculate requirements based on the merged period date range
   */
  private buildTeamConstraints(): void {
    const dateRange = this.getMergedDateRange();
    const totalWeeks = this.calculateDurationWeeks(dateRange.startDate, dateRange.endDate);

    // Calculate weeks where each event type is allowed
    const allDates = getDateRange(dateRange.startDate, dateRange.endDate);
    const gameDates = allDates.filter(date => this.getEventTypeAllowedOnDate(date, 'game'));
    const practiceDates = allDates.filter(date => this.getEventTypeAllowedOnDate(date, 'practice'));
    const cageDates = allDates.filter(date => this.getEventTypeAllowedOnDate(date, 'cage'));

    const gameWeeks = Math.max(1, Math.ceil(gameDates.length / 7));
    const practiceWeeks = Math.max(1, Math.ceil(practiceDates.length / 7));
    const cageWeeks = Math.max(1, Math.ceil(cageDates.length / 7));

    for (const team of this.teams) {
      const config = this.divisionConfigs.get(team.divisionId);
      if (!config) continue;

      this.teamConstraints.set(team.id, {
        teamId: team.id,
        teamName: team.name,
        divisionId: team.divisionId,
        requiredGames: config.gamesPerWeek
          ? Math.floor(config.gamesPerWeek * gameWeeks)
          : 0,
        requiredPractices: Math.floor(config.practicesPerWeek * practiceWeeks),
        requiredCageSessions: config.cageSessionsPerWeek
          ? Math.floor(config.cageSessionsPerWeek * cageWeeks)
          : 0,
        minDaysBetweenEvents: config.minConsecutiveDayGap || 0,
        scheduledEventDates: [],
      });
    }
  }

  /**
   * Calculate duration in weeks between two dates
   */
  private calculateDurationWeeks(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(1, Math.ceil(days / 7));
  }

  /**
   * Get all weeks within the merged period date range
   */
  private getWeeksInPeriods(): Array<{ startDate: string; endDate: string }> {
    const dateRange = this.getMergedDateRange();
    return this.getWeeksInRange(dateRange.startDate, dateRange.endDate);
  }

  /**
   * Get weeks where a specific event type is allowed
   */
  private getWeeksForEventType(eventType: EventType): Array<{ startDate: string; endDate: string }> {
    const dateRange = this.getMergedDateRange();
    const allDates = getDateRange(dateRange.startDate, dateRange.endDate);
    const allowedDates = allDates.filter(date => this.getEventTypeAllowedOnDate(date, eventType));

    if (allowedDates.length === 0) return [];

    const minDate = allowedDates[0];
    const maxDate = allowedDates[allowedDates.length - 1];
    return this.getWeeksInRange(minDate, maxDate);
  }

  /**
   * Get all weeks within a date range
   */
  private getWeeksInRange(startDate: string, endDate: string): Array<{ startDate: string; endDate: string }> {
    const weeks: Array<{ startDate: string; endDate: string }> = [];
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);

    // Start from the beginning of the range
    let currentWeekStart = new Date(rangeStart);

    while (currentWeekStart <= rangeEnd) {
      // Calculate end of this week (6 days later, or range end, whichever comes first)
      const currentWeekEnd = new Date(currentWeekStart);
      currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);

      if (currentWeekEnd > rangeEnd) {
        currentWeekEnd.setTime(rangeEnd.getTime());
      }

      weeks.push({
        startDate: currentWeekStart.toISOString().split('T')[0],
        endDate: currentWeekEnd.toISOString().split('T')[0],
      });

      // Move to next week
      currentWeekStart = new Date(currentWeekEnd);
      currentWeekStart.setDate(currentWeekStart.getDate() + 1);
    }

    return weeks;
  }

  /**
   * Schedule games using round-robin algorithm
   */
  private async scheduleGames(): Promise<void> {
    console.log('\n--- Scheduling Games ---');
    this.log('info', 'game', 'Starting game scheduling phase');

    // Group teams by division
    const teamsByDivision = new Map<string, Team[]>();
    for (const team of this.teams) {
      if (!teamsByDivision.has(team.divisionId)) {
        teamsByDivision.set(team.divisionId, []);
      }
      teamsByDivision.get(team.divisionId)!.push(team);
    }

    console.log(`Total divisions: ${teamsByDivision.size}`);
    this.log('info', 'game', `Found ${teamsByDivision.size} divisions with teams to schedule games for`);

    // Generate matchups for each division
    for (const [divisionId, divisionTeams] of teamsByDivision) {
      const config = this.divisionConfigs.get(divisionId);
      console.log(`\nDivision: ${divisionId}`);
      console.log(`  Teams: ${divisionTeams.length}`);
      console.log(`  Has config: ${!!config}`);
      console.log(`  Games per week: ${config?.gamesPerWeek || 'N/A'}`);

      if (!config || !config.gamesPerWeek) {
        console.log(`  ⏭️  Skipping (no games scheduled for this division)`);
        continue;
      }

      const matchups = this.generateRoundRobinMatchups(divisionTeams, divisionId);
      console.log(`  Total matchups to schedule: ${matchups.length}`);
      console.log(`  Game duration: ${config.gameDurationHours} hours`);

      let scheduled = 0;
      let failed = 0;

      // Try to schedule each matchup
      for (const matchup of matchups) {
        const success = this.scheduleGameMatchup(matchup, config.gameDurationHours!);
        if (!success) {
          failed++;
          this.warnings.push({
            type: 'insufficient_resources',
            message: `Could not schedule game between teams in division ${divisionId}`,
            details: matchup,
          });
        } else {
          scheduled++;
        }
      }

      console.log(`  ✅ Successfully scheduled: ${scheduled}/${matchups.length} games`);
      if (failed > 0) {
        console.log(`  ❌ Failed to schedule: ${failed} games`);
      }
    }

    const totalGames = this.scheduledEvents.filter(e => e.eventType === 'game').length;
    console.log(`\n✅ Game scheduling complete. Total scheduled: ${totalGames}`);
  }

  /**
   * Generate round-robin matchups for a division
   */
  private generateRoundRobinMatchups(
    teams: Team[],
    divisionId: string
  ): GameMatchup[] {
    const matchups: GameMatchup[] = [];

    // Each team plays each other team once (can be extended for multiple rounds)
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        matchups.push({
          homeTeamId: teams[i].id,
          awayTeamId: teams[j].id,
          divisionId,
        });
      }
    }

    // Shuffle to randomize home/away and scheduling order
    return this.shuffleArray(matchups);
  }

  /**
   * Try to schedule a specific game matchup
   */
  private scheduleGameMatchup(
    matchup: GameMatchup,
    durationHours: number
  ): boolean {
    const homeTeam = this.teams.find(t => t.id === matchup.homeTeamId);
    const awayTeam = this.teams.find(t => t.id === matchup.awayTeamId);
    const homeTeamName = homeTeam?.name || matchup.homeTeamId;
    const awayTeamName = awayTeam?.name || matchup.awayTeamId;

    this.log('debug', 'game', `Attempting to schedule: ${homeTeamName} vs ${awayTeamName}`, {
      homeTeamId: matchup.homeTeamId,
      awayTeamId: matchup.awayTeamId,
      divisionId: matchup.divisionId,
      durationHours,
    });

    // Filter game field slots to only those compatible with the division
    const allFieldSlots = this.gameFieldSlots;
    const fieldSlots = allFieldSlots.filter(rs =>
      this.isFieldCompatibleWithDivision(rs.resourceId, matchup.divisionId)
    );

    const incompatibleCount = allFieldSlots.length - fieldSlots.length;
    if (incompatibleCount > 0) {
      this.log('debug', 'game', `Filtered out ${incompatibleCount} field slots incompatible with division`, {
        totalSlots: allFieldSlots.length,
        compatibleSlots: fieldSlots.length,
        divisionId: matchup.divisionId,
      });
    }

    // Track reasons why slots were skipped (for debugging)
    const skipReasons: Record<string, number> = {};
    const skipDetails: Array<{ date: string; field: string; reason: string }> = [];

    // Find available windows that can accommodate the game duration
    for (const rs of fieldSlots) {
      // Try to find a time within this availability window for both teams
      const homeConstraint = this.teamConstraints.get(matchup.homeTeamId);
      const awayConstraint = this.teamConstraints.get(matchup.awayTeamId);

      if (!homeConstraint || !awayConstraint) {
        skipReasons['missing_constraint'] = (skipReasons['missing_constraint'] || 0) + 1;
        skipDetails.push({ date: rs.slot.date, field: rs.resourceName, reason: 'Missing team constraint' });
        continue;
      }

      const result = this.findAvailableTimeInWindowForMatchupWithReason(
        rs.resourceId,
        rs.slot,
        durationHours,
        matchup.homeTeamId,
        matchup.awayTeamId,
        homeConstraint,
        awayConstraint
      );

      if (result.time) {
        const periodId = this.getEventTypeAllowedOnDate(rs.slot.date, 'game');
        if (!periodId) continue; // Should not happen, but safety check

        this.scheduledEvents.push({
          seasonPeriodId: periodId,
          divisionId: matchup.divisionId,
          eventType: 'game',
          date: rs.slot.date,
          startTime: result.time.startTime,
          endTime: result.time.endTime,
          fieldId: rs.resourceId,
          homeTeamId: matchup.homeTeamId,
          awayTeamId: matchup.awayTeamId,
        });

        const dayName = ScheduleGenerator.DAY_NAMES[rs.slot.dayOfWeek];
        this.log('info', 'game', `Scheduled game: ${homeTeamName} vs ${awayTeamName}`, {
          date: rs.slot.date,
          dayOfWeek: rs.slot.dayOfWeek,
          dayName,
          time: `${result.time.startTime}-${result.time.endTime}`,
          resourceName: rs.resourceName,
          reason: `Found available ${durationHours}hr slot on ${rs.resourceName}. Both teams available on this date.`,
        });

        return true;
      } else if (result.reason) {
        skipReasons[result.reason] = (skipReasons[result.reason] || 0) + 1;
        // Add detailed skip info for the first few of each reason type
        if (skipDetails.length < 20) {
          const dayName = ScheduleGenerator.DAY_NAMES[rs.slot.dayOfWeek];
          skipDetails.push({
            date: rs.slot.date,
            field: rs.resourceName,
            reason: this.formatSkipReason(result.reason, homeTeamName, awayTeamName, dayName),
          });
        }
      }
    }

    this.log('warning', 'game', `Could not schedule game: ${homeTeamName} vs ${awayTeamName}`, {
      teamId: matchup.homeTeamId,
      teamName: homeTeamName,
      awayTeamName,
      divisionId: matchup.divisionId,
      slotsChecked: fieldSlots.length,
      skipReasons,
      sampleSkipDetails: skipDetails.slice(0, 10),
    });
    return false;
  }

  /**
   * Format skip reason into human-readable explanation
   */
  private formatSkipReason(reason: string, homeTeam: string, awayTeam: string, dayName: string): string {
    switch (reason) {
      case 'home_team_has_event_on_date':
        return `${homeTeam} already has another event scheduled on this ${dayName}`;
      case 'away_team_has_event_on_date':
        return `${awayTeam} already has another event scheduled on this ${dayName}`;
      case 'no_available_time_slot':
        return `No ${dayName} time slot available (field already booked or duration doesn't fit)`;
      case 'missing_constraint':
        return 'Team scheduling constraint not found';
      default:
        return reason;
    }
  }

  /**
   * Find available time in window for matchup, returning reason if not found
   */
  private findAvailableTimeInWindowForMatchupWithReason(
    fieldId: string,
    availabilityWindow: TimeSlot,
    durationHours: number,
    homeTeamId: string,
    awayTeamId: string,
    homeConstraint: TeamConstraint,
    awayConstraint: TeamConstraint
  ): { time: { startTime: string; endTime: string } | null; reason?: string } {
    // Check if either team already has an event on this date (same-day constraint)
    const homeTeamHasEventToday = this.scheduledEvents.some(event =>
      event.date === availabilityWindow.date &&
      (event.teamId === homeTeamId || event.homeTeamId === homeTeamId || event.awayTeamId === homeTeamId)
    );

    if (homeTeamHasEventToday) {
      return { time: null, reason: 'home_team_has_event_on_date' };
    }

    const awayTeamHasEventToday = this.scheduledEvents.some(event =>
      event.date === availabilityWindow.date &&
      (event.teamId === awayTeamId || event.homeTeamId === awayTeamId || event.awayTeamId === awayTeamId)
    );

    if (awayTeamHasEventToday) {
      return { time: null, reason: 'away_team_has_event_on_date' };
    }

    // Parse window times
    const [windowStartHour, windowStartMin] = availabilityWindow.startTime.split(':').map(Number);
    const [windowEndHour, windowEndMin] = availabilityWindow.endTime.split(':').map(Number);

    const windowStartMinutes = windowStartHour * 60 + windowStartMin;
    const windowEndMinutes = windowEndHour * 60 + windowEndMin;
    const durationMinutes = durationHours * 60;

    // Try to find a slot starting from the beginning of the window
    for (let startMinutes = windowStartMinutes; startMinutes + durationMinutes <= windowEndMinutes; startMinutes += 30) {
      const endMinutes = startMinutes + durationMinutes;

      const startHour = Math.floor(startMinutes / 60);
      const startMin = startMinutes % 60;
      const endHour = Math.floor(endMinutes / 60);
      const endMin = endMinutes % 60;

      const candidateStartTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
      const candidateEndTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      // Check if this time conflicts with existing events on this field
      const hasConflict = this.scheduledEvents.some(event => {
        if (event.date !== availabilityWindow.date) return false;
        if (event.fieldId !== fieldId) return false;
        return this.timesOverlap(event.startTime, event.endTime, candidateStartTime, candidateEndTime);
      });

      if (hasConflict) {
        continue;
      }

      const candidateSlot: TimeSlot = {
        date: availabilityWindow.date,
        dayOfWeek: availabilityWindow.dayOfWeek,
        startTime: candidateStartTime,
        endTime: candidateEndTime,
        duration: durationHours,
      };

      // Check if both teams are available at this time
      if (!areTeamsAvailableForMatchup(
        homeTeamId,
        awayTeamId,
        candidateSlot,
        this.teamConstraints,
        this.scheduledEvents
      )) {
        continue;
      }

      // Found a suitable time!
      return {
        time: { startTime: candidateStartTime, endTime: candidateEndTime },
      };
    }

    return { time: null, reason: 'no_available_time_slot' };
  }

  /**
   * Schedule practices for all teams
   */
  private async schedulePractices(): Promise<void> {
    console.log('\n--- Scheduling Practices ---');
    console.log(`Total teams: ${this.teams.length}`);
    this.log('info', 'practice', 'Starting practice scheduling phase');

    // Schedule practices week by week to ensure proper distribution
    const weeks = this.getWeeksForEventType('practice');
    console.log(`Total weeks for practices: ${weeks.length}`);
    this.log('info', 'practice', `Scheduling practices across ${weeks.length} weeks`, {
      firstWeek: weeks[0]?.startDate,
      lastWeek: weeks[weeks.length - 1]?.endDate,
    });

    for (const team of this.teams) {
      const constraint = this.teamConstraints.get(team.id);
      const config = this.divisionConfigs.get(team.divisionId);

      console.log(`\nTeam: ${team.name} (${team.id})`);
      console.log(`  Division: ${team.divisionId}`);
      console.log(`  Has constraint: ${!!constraint}`);
      console.log(`  Has config: ${!!config}`);

      if (!constraint || !config) {
        console.log(`  ⏭️  Skipping (missing constraint/config)`);
        continue;
      }

      console.log(`  Required practices per week: ${config.practicesPerWeek}`);
      console.log(`  Practice duration: ${config.practiceDurationHours} hours`);

      // Schedule practices week by week
      for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
        const week = weeks[weekIndex];
        console.log(`  Week ${weekIndex + 1} (${week.startDate} to ${week.endDate}):`);

        // Count how many practices already scheduled this week
        const practicesThisWeek = this.scheduledEvents.filter(e =>
          e.eventType === 'practice' &&
          e.teamId === team.id &&
          e.date >= week.startDate &&
          e.date <= week.endDate
        ).length;

        const practicesNeeded = config.practicesPerWeek - practicesThisWeek;
        console.log(`    Already scheduled: ${practicesThisWeek}, Need: ${practicesNeeded}`);

        for (let i = 0; i < practicesNeeded; i++) {
          console.log(`    Attempting to schedule practice ${i + 1}/${practicesNeeded}...`);
          const scheduled = this.schedulePracticeInWeek(
            team.id,
            team.divisionId,
            config.practiceDurationHours,
            week
          );
          if (!scheduled) {
            console.log(`    ❌ Failed to schedule practice ${i + 1}`);
            this.warnings.push({
              type: 'insufficient_resources',
              message: `Could not schedule all practices for team ${team.name} in week ${weekIndex + 1}`,
              details: { teamId: team.id, week: weekIndex + 1 },
            });
            break;
          }
          console.log(`    ✅ Successfully scheduled practice ${i + 1}`);
        }
      }
    }

    const totalPractices = this.scheduledEvents.filter(e => e.eventType === 'practice').length;
    console.log(`\n✅ Practice scheduling complete. Total scheduled: ${totalPractices}`);
  }

  /**
   * Try to schedule a practice for a team within a specific week.
   */
  private schedulePracticeInWeek(
    teamId: string,
    divisionId: string,
    durationHours: number,
    week: { startDate: string; endDate: string }
  ): boolean {
    const constraint = this.teamConstraints.get(teamId);
    const team = this.teams.find(t => t.id === teamId);
    const teamName = team?.name || teamId;

    if (!constraint) {
      console.log(`      ⚠️  No constraint found for team ${teamId}`);
      this.log('warning', 'practice', `No constraint found for team ${teamName}`, { teamId });
      return false;
    }

    // Filter practice field slots to only those within this week and compatible with the division
    const allSlotsInWeek = this.practiceFieldSlots.filter(
      rs => rs.slot.date >= week.startDate && rs.slot.date <= week.endDate
    );
    const fieldSlots = allSlotsInWeek.filter(
      rs => this.isFieldCompatibleWithDivision(rs.resourceId, divisionId)
    );

    console.log(`      Field availability windows in this week: ${fieldSlots.length}`);

    const skipReasons: Record<string, number> = {};
    const skipDetails: Array<{ date: string; field: string; reason: string }> = [];

    // Find available windows that can accommodate the practice duration
    for (const rs of fieldSlots) {
      const dayName = ScheduleGenerator.DAY_NAMES[rs.slot.dayOfWeek];

      // Check if team already has event on this date
      const teamHasEventToday = this.scheduledEvents.some(event =>
        event.date === rs.slot.date &&
        (event.teamId === teamId || event.homeTeamId === teamId || event.awayTeamId === teamId)
      );

      if (teamHasEventToday) {
        skipReasons['team_has_event_on_date'] = (skipReasons['team_has_event_on_date'] || 0) + 1;
        if (skipDetails.length < 10) {
          skipDetails.push({
            date: rs.slot.date,
            field: rs.resourceName,
            reason: `${teamName} already has another event on this ${dayName}`,
          });
        }
        continue;
      }

      // Normal practice scheduling
      const availableTime = this.findAvailableTimeInWindow(
        rs.resourceId,
        'field',
        rs.slot,
        durationHours,
        teamId,
        constraint
      );

      if (availableTime) {
        const periodId = this.getEventTypeAllowedOnDate(rs.slot.date, 'practice');
        if (!periodId) continue;

        console.log(`      ✅ Chose slot: ${rs.slot.date} ${availableTime.startTime}-${availableTime.endTime} at field ${rs.resourceId}`);

        this.scheduledEvents.push({
          seasonPeriodId: periodId,
          divisionId,
          eventType: 'practice',
          date: rs.slot.date,
          startTime: availableTime.startTime,
          endTime: availableTime.endTime,
          fieldId: rs.resourceId,
          teamId,
        });

        this.log('info', 'practice', `Scheduled practice for ${teamName}`, {
          teamId,
          teamName,
          date: rs.slot.date,
          dayOfWeek: rs.slot.dayOfWeek,
          dayName,
          time: `${availableTime.startTime}-${availableTime.endTime}`,
          resourceName: rs.resourceName,
          reason: `Found ${durationHours}hr slot on ${rs.resourceName}. Team has no other events on ${dayName}.`,
        });

        return true;
      } else {
        skipReasons['no_time_slot_available'] = (skipReasons['no_time_slot_available'] || 0) + 1;
        if (skipDetails.length < 10) {
          skipDetails.push({
            date: rs.slot.date,
            field: rs.resourceName,
            reason: `Field already booked or ${durationHours}hr duration doesn't fit in ${rs.slot.startTime}-${rs.slot.endTime}`,
          });
        }
      }
    }

    console.log(`      ❌ No suitable time found in any availability window this week`);
    this.log('warning', 'practice', `Could not schedule practice for ${teamName} in week ${week.startDate}`, {
      teamId,
      teamName,
      weekStart: week.startDate,
      weekEnd: week.endDate,
      slotsChecked: fieldSlots.length,
      skipReasons,
      sampleSkipDetails: skipDetails,
    });
    return false;
  }

  /**
   * Try to schedule back-to-back field practice and cage session on a weekend during preseason.
   * Tries both orders: field-then-cage and cage-then-field.
   */
  private tryScheduleBackToBackFieldAndCage(
    teamId: string,
    divisionId: string,
    fieldSlot: ResourceSlot,
    practiceDuration: number,
    cageDuration: number,
    constraint: TeamConstraint
  ): boolean {
    const date = fieldSlot.slot.date;
    const dayOfWeek = fieldSlot.slot.dayOfWeek;

    // Get available cages for this date that are compatible with the division
    const availableCageSlots = this.cageSlots.filter(
      rs => rs.slot.date === date &&
      this.isCageCompatibleWithDivision(rs.resourceId, divisionId)
    );

    if (availableCageSlots.length === 0) {
      return false;
    }

    // Total duration needed for back-to-back
    const totalDuration = practiceDuration + cageDuration;

    // Parse field availability window
    const fieldStartMinutes = timeToMinutes(fieldSlot.slot.startTime);
    const fieldEndMinutes = timeToMinutes(fieldSlot.slot.endTime);

    // Try each cage slot
    for (const cageSlot of availableCageSlots) {
      const cageStartMinutes = timeToMinutes(cageSlot.slot.startTime);
      const cageEndMinutes = timeToMinutes(cageSlot.slot.endTime);

      // Find overlapping window where both field and cage are available
      const overlapStart = Math.max(fieldStartMinutes, cageStartMinutes);
      const overlapEnd = Math.min(fieldEndMinutes, cageEndMinutes);

      if (overlapEnd - overlapStart < totalDuration * 60) {
        continue; // Not enough time for back-to-back
      }

      // Try to find a contiguous block within the overlap
      const practiceMinutes = practiceDuration * 60;
      const cageMinutes = cageDuration * 60;

      for (let startMinutes = overlapStart; startMinutes + totalDuration * 60 <= overlapEnd; startMinutes += 30) {
        // Try field-then-cage order
        const fieldStart = minutesToTime(startMinutes);
        const fieldEnd = minutesToTime(startMinutes + practiceMinutes);
        const cageStart = fieldEnd; // Cage starts immediately after field
        const cageEnd = minutesToTime(startMinutes + practiceMinutes + cageMinutes);

        // Check if field slot is available
        const fieldConflict = this.hasResourceConflict(fieldSlot.resourceId, 'field', date, fieldStart, fieldEnd);
        const cageConflict = this.hasResourceConflict(cageSlot.resourceId, 'cage', date, cageStart, cageEnd);

        if (!fieldConflict && !cageConflict) {
          const practicePeriodId = this.getEventTypeAllowedOnDate(date, 'practice');
          const cagePeriodId = this.getEventTypeAllowedOnDate(date, 'cage');
          if (!practicePeriodId || !cagePeriodId) continue;

          // Schedule both events
          this.scheduledEvents.push({
            seasonPeriodId: practicePeriodId,
            divisionId,
            eventType: 'practice',
            date,
            startTime: fieldStart,
            endTime: fieldEnd,
            fieldId: fieldSlot.resourceId,
            teamId,
          });

          this.scheduledEvents.push({
            seasonPeriodId: cagePeriodId,
            divisionId,
            eventType: 'cage',
            date,
            startTime: cageStart,
            endTime: cageEnd,
            cageId: cageSlot.resourceId,
            teamId,
          });

          return true;
        }

        // Try cage-then-field order
        const cageStartAlt = minutesToTime(startMinutes);
        const cageEndAlt = minutesToTime(startMinutes + cageMinutes);
        const fieldStartAlt = cageEndAlt; // Field starts immediately after cage
        const fieldEndAlt = minutesToTime(startMinutes + cageMinutes + practiceMinutes);

        const fieldConflictAlt = this.hasResourceConflict(fieldSlot.resourceId, 'field', date, fieldStartAlt, fieldEndAlt);
        const cageConflictAlt = this.hasResourceConflict(cageSlot.resourceId, 'cage', date, cageStartAlt, cageEndAlt);

        if (!fieldConflictAlt && !cageConflictAlt) {
          const practicePeriodId = this.getEventTypeAllowedOnDate(date, 'practice');
          const cagePeriodId = this.getEventTypeAllowedOnDate(date, 'cage');
          if (!practicePeriodId || !cagePeriodId) continue;

          // Schedule both events (cage first)
          this.scheduledEvents.push({
            seasonPeriodId: cagePeriodId,
            divisionId,
            eventType: 'cage',
            date,
            startTime: cageStartAlt,
            endTime: cageEndAlt,
            cageId: cageSlot.resourceId,
            teamId,
          });

          this.scheduledEvents.push({
            seasonPeriodId: practicePeriodId,
            divisionId,
            eventType: 'practice',
            date,
            startTime: fieldStartAlt,
            endTime: fieldEndAlt,
            fieldId: fieldSlot.resourceId,
            teamId,
          });

          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a resource has a conflict at the given time
   */
  private hasResourceConflict(
    resourceId: string,
    resourceType: 'field' | 'cage',
    date: string,
    startTime: string,
    endTime: string
  ): boolean {
    return this.scheduledEvents.some(event => {
      if (event.date !== date) return false;
      const eventResourceId = resourceType === 'field' ? event.fieldId : event.cageId;
      if (eventResourceId !== resourceId) return false;
      return this.timesOverlap(event.startTime, event.endTime, startTime, endTime);
    });
  }

  /**
   * Schedule cage sessions for all teams
   */
  private async scheduleCageSessions(): Promise<void> {
    console.log('\n--- Scheduling Cage Sessions ---');
    console.log(`Total teams: ${this.teams.length}`);
    this.log('info', 'cage', 'Starting cage session scheduling phase');

    // Schedule cage sessions week by week to ensure proper distribution
    const weeks = this.getWeeksForEventType('cage');
    console.log(`Total weeks for cages: ${weeks.length}`);
    this.log('info', 'cage', `Scheduling cage sessions across ${weeks.length} weeks`, {
      firstWeek: weeks[0]?.startDate,
      lastWeek: weeks[weeks.length - 1]?.endDate,
    });

    for (const team of this.teams) {
      const constraint = this.teamConstraints.get(team.id);
      const config = this.divisionConfigs.get(team.divisionId);

      console.log(`\nTeam: ${team.name} (${team.id})`);
      console.log(`  Division: ${team.divisionId}`);
      console.log(`  Has constraint: ${!!constraint}`);
      console.log(`  Has config: ${!!config}`);
      console.log(`  Config cageSessionsPerWeek: ${config?.cageSessionsPerWeek || 'N/A'}`);

      if (!constraint || !config || !config.cageSessionsPerWeek) {
        console.log(`  ⏭️  Skipping (missing constraint/config or no cage sessions required)`);
        continue;
      }

      console.log(`  Required cage sessions per week: ${config.cageSessionsPerWeek}`);

      // Schedule cage sessions week by week
      for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
        const week = weeks[weekIndex];
        console.log(`  Week ${weekIndex + 1} (${week.startDate} to ${week.endDate}):`);

        // Count how many cage sessions already scheduled this week
        const sessionsThisWeek = this.scheduledEvents.filter(e =>
          e.eventType === 'cage' &&
          e.teamId === team.id &&
          e.date >= week.startDate &&
          e.date <= week.endDate
        ).length;

        const sessionsNeeded = config.cageSessionsPerWeek - sessionsThisWeek;
        console.log(`    Already scheduled: ${sessionsThisWeek}, Need: ${sessionsNeeded}`);

        for (let i = 0; i < sessionsNeeded; i++) {
          console.log(`    Attempting to schedule cage session ${i + 1}/${sessionsNeeded}...`);
          const scheduled = this.scheduleCageSessionInWeek(team.id, team.divisionId, week);
          if (!scheduled) {
            console.log(`    ❌ Failed to schedule cage session ${i + 1}`);
            this.warnings.push({
              type: 'insufficient_resources',
              message: `Could not schedule all cage sessions for team ${team.name} in week ${weekIndex + 1}`,
              details: { teamId: team.id, week: weekIndex + 1 },
            });
            break;
          }
          console.log(`    ✅ Successfully scheduled cage session ${i + 1}`);
        }
      }
    }

    const totalCageSessions = this.scheduledEvents.filter(e => e.eventType === 'cage').length;
    console.log(`\n✅ Cage session scheduling complete. Total scheduled: ${totalCageSessions}`);
  }

  /**
   * Try to schedule a cage session for a team within a specific week
   */
  private scheduleCageSessionInWeek(
    teamId: string,
    divisionId: string,
    week: { startDate: string; endDate: string }
  ): boolean {
    const constraint = this.teamConstraints.get(teamId);
    const team = this.teams.find(t => t.id === teamId);
    const teamName = team?.name || teamId;

    if (!constraint) {
      console.log(`      ⚠️  No constraint found for team ${teamId}`);
      this.log('warning', 'cage', `No constraint found for team ${teamName}`, { teamId });
      return false;
    }

    const config = this.divisionConfigs.get(divisionId);

    // Filter cage slots to only those within this week and compatible with the division
    const filteredCageSlots = this.cageSlots.filter(
      rs => rs.slot.date >= week.startDate &&
      rs.slot.date <= week.endDate &&
      this.isCageCompatibleWithDivision(rs.resourceId, divisionId)
    );
    console.log(`      Cage availability windows in this week: ${filteredCageSlots.length}`);

    // Use division-configured cage session duration, default to 1 hour
    const cageSessionDuration = config?.cageSessionDurationHours ?? 1;

    const skipReasons: Record<string, number> = {};
    const skipDetails: Array<{ date: string; cage: string; reason: string }> = [];

    // Find available windows that can accommodate a cage session
    for (const rs of filteredCageSlots) {
      const dayName = ScheduleGenerator.DAY_NAMES[rs.slot.dayOfWeek];

      // On weekdays, skip days where team already has a practice
      if (this.isWeekday(rs.slot.dayOfWeek)) {
        const teamHasPracticeToday = this.scheduledEvents.some(event =>
          event.date === rs.slot.date &&
          event.eventType === 'practice' &&
          event.teamId === teamId
        );
        if (teamHasPracticeToday) {
          skipReasons['weekday_has_practice'] = (skipReasons['weekday_has_practice'] || 0) + 1;
          if (skipDetails.length < 10) {
            skipDetails.push({
              date: rs.slot.date,
              cage: rs.resourceName,
              reason: `${teamName} already has practice on this ${dayName} (weekday rule: no cage + practice on same weekday)`,
            });
          }
          continue;
        }
      }

      // Try to find a time within this availability window
      const result = this.findAvailableTimeInWindowForCageWithReason(
        rs.resourceId,
        rs.slot,
        cageSessionDuration,
        teamId,
        constraint
      );

      if (result.time) {
        const periodId = this.getEventTypeAllowedOnDate(rs.slot.date, 'cage');
        if (!periodId) continue;

        console.log(`      ✅ Chose slot: ${rs.slot.date} ${result.time.startTime}-${result.time.endTime} at cage ${rs.resourceId}`);

        this.scheduledEvents.push({
          seasonPeriodId: periodId,
          divisionId,
          eventType: 'cage',
          date: rs.slot.date,
          startTime: result.time.startTime,
          endTime: result.time.endTime,
          cageId: rs.resourceId,
          teamId,
        });

        this.log('info', 'cage', `Scheduled cage session for ${teamName}`, {
          teamId,
          teamName,
          date: rs.slot.date,
          dayOfWeek: rs.slot.dayOfWeek,
          dayName,
          time: `${result.time.startTime}-${result.time.endTime}`,
          resourceName: rs.resourceName,
          reason: result.reason || `Found ${cageSessionDuration}hr slot on ${rs.resourceName}`,
        });

        return true;
      } else if (result.skipReason) {
        skipReasons[result.skipReason] = (skipReasons[result.skipReason] || 0) + 1;
        if (skipDetails.length < 10) {
          skipDetails.push({
            date: rs.slot.date,
            cage: rs.resourceName,
            reason: this.formatCageSkipReason(result.skipReason, teamName, dayName, rs.slot.startTime, rs.slot.endTime),
          });
        }
      }
    }

    console.log(`      ❌ No suitable time found in any availability window this week`);
    this.log('warning', 'cage', `Could not schedule cage session for ${teamName} in week ${week.startDate}`, {
      teamId,
      teamName,
      weekStart: week.startDate,
      weekEnd: week.endDate,
      slotsChecked: filteredCageSlots.length,
      skipReasons,
      sampleSkipDetails: skipDetails,
    });
    return false;
  }

  /**
   * Format cage skip reason into human-readable explanation
   */
  private formatCageSkipReason(reason: string, teamName: string, dayName: string, windowStart: string, windowEnd: string): string {
    switch (reason) {
      case 'team_has_non_game_event':
        return `${teamName} already has practice or cage on this ${dayName}`;
      case 'game_day_not_playing_before_cutoff':
        return `Game day priority: ${teamName} not playing today, can only use cage after 4:45pm`;
      case 'game_day_playing_after_cutoff':
        return `Game day priority: ${teamName} is playing today, cage only available before 4:45pm`;
      case 'no_time_slot_fits':
        return `No available time slot fits in ${windowStart}-${windowEnd} window`;
      case 'cage_already_booked':
        return `Cage already booked during available times`;
      default:
        return reason;
    }
  }

  /**
   * Check if a field is compatible with a division.
   * Empty divisionCompatibility array means all divisions are allowed.
   */
  private isFieldCompatibleWithDivision(fieldId: string, divisionId: string): boolean {
    const compatibility = this.fieldDivisionCompatibility.get(fieldId);
    // If no compatibility configured (empty array or undefined), allow all divisions
    if (!compatibility || compatibility.length === 0) {
      return true;
    }
    return compatibility.includes(divisionId);
  }

  /**
   * Check if a cage is compatible with a division.
   * Empty divisionCompatibility array means all divisions are allowed.
   */
  private isCageCompatibleWithDivision(cageId: string, divisionId: string): boolean {
    const compatibility = this.cageDivisionCompatibility.get(cageId);
    // If no compatibility configured (empty array or undefined), allow all divisions
    if (!compatibility || compatibility.length === 0) {
      return true;
    }
    return compatibility.includes(divisionId);
  }

  /**
   * Check if a day is a weekday (Monday-Friday)
   */
  private isWeekday(dayOfWeek: number): boolean {
    // 0 = Sunday, 6 = Saturday
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }

  /**
   * Check if a day is a weekend (Saturday or Sunday)
   */
  private isWeekend(dayOfWeek: number): boolean {
    return dayOfWeek === 0 || dayOfWeek === 6;
  }

  /**
   * Get teams that have a game scheduled on a specific date
   */
  private getTeamsWithGamesOnDate(date: string): Set<string> {
    const teamsWithGames = new Set<string>();
    for (const event of this.scheduledEvents) {
      if (event.date === date && event.eventType === 'game') {
        if (event.homeTeamId) teamsWithGames.add(event.homeTeamId);
        if (event.awayTeamId) teamsWithGames.add(event.awayTeamId);
      }
    }
    return teamsWithGames;
  }

  /**
   * Find available cage time for a team, respecting game day priority rules.
   * On game days, teams playing have cage priority until 4:45pm (16:45).
   * Returns both time and reason for logging.
   */
  private findAvailableTimeInWindowForCageWithReason(
    cageId: string,
    availabilityWindow: TimeSlot,
    durationHours: number,
    teamId: string,
    teamConstraint: TeamConstraint
  ): { time: { startTime: string; endTime: string } | null; reason?: string; skipReason?: string } {
    // Check if team already has an event on this date (same-day constraint)
    // But allow cage on game days for teams that are playing
    const teamEventsToday = this.scheduledEvents.filter(event =>
      event.date === availabilityWindow.date &&
      (event.teamId === teamId || event.homeTeamId === teamId || event.awayTeamId === teamId)
    );

    const teamHasGameToday = teamEventsToday.some(e => e.eventType === 'game');
    const teamHasNonGameEventToday = teamEventsToday.some(e => e.eventType !== 'game');

    // If team has a non-game event today (practice or cage), skip
    if (teamHasNonGameEventToday) {
      return { time: null, skipReason: 'team_has_non_game_event' };
    }

    // Get all teams that have games on this date
    const teamsWithGamesToday = this.getTeamsWithGamesOnDate(availabilityWindow.date);
    const isGameDay = teamsWithGamesToday.size > 0;
    const teamIsPlayingToday = teamsWithGamesToday.has(teamId);

    // Parse window times
    const [windowStartHour, windowStartMin] = availabilityWindow.startTime.split(':').map(Number);
    const [windowEndHour, windowEndMin] = availabilityWindow.endTime.split(':').map(Number);

    let windowStartMinutes = windowStartHour * 60 + windowStartMin;
    let windowEndMinutes = windowEndHour * 60 + windowEndMin;
    const durationMinutes = durationHours * 60;

    // Game day cage priority: until 4:45pm (16:45 = 1005 minutes)
    const PRIORITY_CUTOFF_MINUTES = 16 * 60 + 45; // 4:45pm

    // On game days, apply priority rules (teams playing get cage priority before 4:45pm)
    if (isGameDay) {
      if (teamIsPlayingToday) {
        // Team playing today can only use cages before 4:45pm
        windowEndMinutes = Math.min(windowEndMinutes, PRIORITY_CUTOFF_MINUTES);
      } else {
        // Team NOT playing can only use cages after 4:45pm
        windowStartMinutes = Math.max(windowStartMinutes, PRIORITY_CUTOFF_MINUTES);
      }

      // Check if the window is still valid after applying priority rules
      if (windowStartMinutes + durationMinutes > windowEndMinutes) {
        if (teamIsPlayingToday) {
          return { time: null, skipReason: 'game_day_playing_after_cutoff' };
        } else {
          return { time: null, skipReason: 'game_day_not_playing_before_cutoff' };
        }
      }
    }

    // Try to find a slot starting from the beginning of the window
    let anyConflict = false;
    for (let startMinutes = windowStartMinutes; startMinutes + durationMinutes <= windowEndMinutes; startMinutes += 30) {
      const endMinutes = startMinutes + durationMinutes;

      const startHour = Math.floor(startMinutes / 60);
      const startMin = startMinutes % 60;
      const endHour = Math.floor(endMinutes / 60);
      const endMin = endMinutes % 60;

      const candidateStartTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
      const candidateEndTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      // Check if this time conflicts with existing events on this cage
      const hasConflict = this.scheduledEvents.some(event => {
        if (event.date !== availabilityWindow.date) return false;
        if (event.cageId !== cageId) return false;

        return this.timesOverlap(
          event.startTime,
          event.endTime,
          candidateStartTime,
          candidateEndTime
        );
      });

      if (hasConflict) {
        anyConflict = true;
        continue;
      }

      // Found a suitable time!
      let reason = `Found ${durationHours}hr slot`;
      if (isGameDay && teamIsPlayingToday) {
        reason += ' (game day priority: team playing, using pre-4:45pm slot)';
      } else if (isGameDay) {
        reason += ' (game day: team not playing, using post-4:45pm slot)';
      }
      return {
        time: { startTime: candidateStartTime, endTime: candidateEndTime },
        reason,
      };
    }

    return {
      time: null,
      skipReason: anyConflict ? 'cage_already_booked' : 'no_time_slot_fits',
    };
  }

  /**
   * Find available cage time for a team (legacy method, calls WithReason variant)
   */
  private findAvailableTimeInWindowForCage(
    cageId: string,
    availabilityWindow: TimeSlot,
    durationHours: number,
    teamId: string,
    teamConstraint: TeamConstraint
  ): { startTime: string; endTime: string } | null {
    const result = this.findAvailableTimeInWindowForCageWithReason(cageId, availabilityWindow, durationHours, teamId, teamConstraint);
    return result.time;
  }

  /**
   * Find an available time slot within an availability window for a single team
   */
  private findAvailableTimeInWindow(
    resourceId: string,
    resourceType: 'field' | 'cage',
    availabilityWindow: TimeSlot,
    durationHours: number,
    teamId: string,
    teamConstraint: TeamConstraint
  ): { startTime: string; endTime: string } | null {
    // Check if team already has an event on this date (same-day constraint)
    const teamHasEventToday = this.scheduledEvents.some(event =>
      event.date === availabilityWindow.date &&
      (event.teamId === teamId || event.homeTeamId === teamId || event.awayTeamId === teamId)
    );

    if (teamHasEventToday) {
      // Team already has an event scheduled on this day, skip this date
      return null;
    }

    // Parse window times
    const [windowStartHour, windowStartMin] = availabilityWindow.startTime.split(':').map(Number);
    const [windowEndHour, windowEndMin] = availabilityWindow.endTime.split(':').map(Number);

    const windowStartMinutes = windowStartHour * 60 + windowStartMin;
    const windowEndMinutes = windowEndHour * 60 + windowEndMin;
    const durationMinutes = durationHours * 60;

    // Try to find a slot starting from the beginning of the window
    // We'll try every 30-minute increment
    for (let startMinutes = windowStartMinutes; startMinutes + durationMinutes <= windowEndMinutes; startMinutes += 30) {
      const endMinutes = startMinutes + durationMinutes;

      const startHour = Math.floor(startMinutes / 60);
      const startMin = startMinutes % 60;
      const endHour = Math.floor(endMinutes / 60);
      const endMin = endMinutes % 60;

      const candidateStartTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
      const candidateEndTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      const candidateSlot: TimeSlot = {
        date: availabilityWindow.date,
        dayOfWeek: availabilityWindow.dayOfWeek,
        startTime: candidateStartTime,
        endTime: candidateEndTime,
        duration: durationHours,
      };

      // Check if this time conflicts with existing events on this resource
      const hasConflict = this.scheduledEvents.some(event => {
        if (event.date !== availabilityWindow.date) return false;

        const eventResourceId = resourceType === 'field' ? event.fieldId : event.cageId;
        if (eventResourceId !== resourceId) return false;

        // Check for time overlap
        return this.timesOverlap(
          event.startTime,
          event.endTime,
          candidateStartTime,
          candidateEndTime
        );
      });

      if (hasConflict) {
        continue;
      }

      // Check if team is available at this time
      if (!isTeamAvailable(teamId, candidateSlot, teamConstraint, this.scheduledEvents)) {
        continue;
      }

      // Found a suitable time!
      return {
        startTime: candidateStartTime,
        endTime: candidateEndTime,
      };
    }

    return null;
  }

  /**
   * Find an available time slot within an availability window for a game (two teams)
   */
  private findAvailableTimeInWindowForMatchup(
    fieldId: string,
    availabilityWindow: TimeSlot,
    durationHours: number,
    homeTeamId: string,
    awayTeamId: string,
    homeConstraint: TeamConstraint,
    awayConstraint: TeamConstraint
  ): { startTime: string; endTime: string } | null {
    // Check if either team already has an event on this date (same-day constraint)
    const homeTeamHasEventToday = this.scheduledEvents.some(event =>
      event.date === availabilityWindow.date &&
      (event.teamId === homeTeamId || event.homeTeamId === homeTeamId || event.awayTeamId === homeTeamId)
    );

    const awayTeamHasEventToday = this.scheduledEvents.some(event =>
      event.date === availabilityWindow.date &&
      (event.teamId === awayTeamId || event.homeTeamId === awayTeamId || event.awayTeamId === awayTeamId)
    );

    if (homeTeamHasEventToday || awayTeamHasEventToday) {
      // One or both teams already have an event scheduled on this day, skip this date
      return null;
    }

    // Parse window times
    const [windowStartHour, windowStartMin] = availabilityWindow.startTime.split(':').map(Number);
    const [windowEndHour, windowEndMin] = availabilityWindow.endTime.split(':').map(Number);

    const windowStartMinutes = windowStartHour * 60 + windowStartMin;
    const windowEndMinutes = windowEndHour * 60 + windowEndMin;
    const durationMinutes = durationHours * 60;

    // Try to find a slot starting from the beginning of the window
    for (let startMinutes = windowStartMinutes; startMinutes + durationMinutes <= windowEndMinutes; startMinutes += 30) {
      const endMinutes = startMinutes + durationMinutes;

      const startHour = Math.floor(startMinutes / 60);
      const startMin = startMinutes % 60;
      const endHour = Math.floor(endMinutes / 60);
      const endMin = endMinutes % 60;

      const candidateStartTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
      const candidateEndTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      const candidateSlot: TimeSlot = {
        date: availabilityWindow.date,
        dayOfWeek: availabilityWindow.dayOfWeek,
        startTime: candidateStartTime,
        endTime: candidateEndTime,
        duration: durationHours,
      };

      // Check if this time conflicts with existing events on this field
      const hasConflict = this.scheduledEvents.some(event => {
        if (event.date !== availabilityWindow.date) return false;
        if (event.fieldId !== fieldId) return false;

        // Check for time overlap
        return this.timesOverlap(
          event.startTime,
          event.endTime,
          candidateStartTime,
          candidateEndTime
        );
      });

      if (hasConflict) {
        continue;
      }

      // Check if both teams are available at this time
      if (!areTeamsAvailableForMatchup(
        homeTeamId,
        awayTeamId,
        candidateSlot,
        this.teamConstraints,
        this.scheduledEvents
      )) {
        continue;
      }

      // Found a suitable time!
      return {
        startTime: candidateStartTime,
        endTime: candidateEndTime,
      };
    }

    return null;
  }

  /**
   * Check if two time ranges overlap
   */
  private timesOverlap(
    start1: string,
    end1: string,
    start2: string,
    end2: string
  ): boolean {
    const [s1h, s1m] = start1.split(':').map(Number);
    const [e1h, e1m] = end1.split(':').map(Number);
    const [s2h, s2m] = start2.split(':').map(Number);
    const [e2h, e2m] = end2.split(':').map(Number);

    const s1 = s1h * 60 + s1m;
    const e1 = e1h * 60 + e1m;
    const s2 = s2h * 60 + s2m;
    const e2 = e2h * 60 + e2m;

    return s1 < e2 && s2 < e1;
  }

  /**
   * Shuffle an array using Fisher-Yates algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Build the final result
   */
  private buildResult(success: boolean): GenerateScheduleResult {
    return {
      success,
      eventsCreated: this.scheduledEvents.length,
      message: success
        ? `Successfully generated ${this.scheduledEvents.length} events`
        : 'Failed to generate schedule',
      errors: this.errors.length > 0 ? this.errors : undefined,
      warnings: this.warnings.length > 0 ? this.warnings : undefined,
      statistics: {
        totalEvents: this.scheduledEvents.length,
        eventsByType: {
          game: this.scheduledEvents.filter((e) => e.eventType === 'game').length,
          practice: this.scheduledEvents.filter((e) => e.eventType === 'practice')
            .length,
          cage: this.scheduledEvents.filter((e) => e.eventType === 'cage').length,
        },
        eventsByDivision: this.calculateEventsByDivision(),
        averageEventsPerTeam: this.calculateAverageEventsPerTeam(),
      },
      schedulingLog: this.schedulingLog.length > 0 ? this.schedulingLog : undefined,
    };
  }

  private calculateEventsByDivision(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const event of this.scheduledEvents) {
      result[event.divisionId] = (result[event.divisionId] || 0) + 1;
    }
    return result;
  }

  private calculateAverageEventsPerTeam(): number {
    if (this.teams.length === 0) return 0;

    const eventCounts = new Map<string, number>();
    for (const event of this.scheduledEvents) {
      if (event.teamId) {
        eventCounts.set(event.teamId, (eventCounts.get(event.teamId) || 0) + 1);
      }
      if (event.homeTeamId) {
        eventCounts.set(event.homeTeamId, (eventCounts.get(event.homeTeamId) || 0) + 1);
      }
      if (event.awayTeamId) {
        eventCounts.set(event.awayTeamId, (eventCounts.get(event.awayTeamId) || 0) + 1);
      }
    }

    const totalEvents = Array.from(eventCounts.values()).reduce((a, b) => a + b, 0);
    return totalEvents / this.teams.length;
  }

  /**
   * Get the scheduled events
   */
  getScheduledEvents(): ScheduledEventDraft[] {
    return this.scheduledEvents;
  }
}
