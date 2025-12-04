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
  Season,
  Division,
  DivisionConfig,
  Team,
  SeasonField,
  SeasonCage,
  FieldAvailability,
  CageAvailability,
  FieldDateOverride,
  CageDateOverride,
  EventType,
  ScoringWeights,
  TeamSchedulingState,
  PlacementCandidate,
  WeekDefinition,
} from '@ll-scheduler/shared';
import { DEFAULT_SCORING_WEIGHTS } from '@ll-scheduler/shared';
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
import {
  calculatePlacementScore,
  createScoringContext,
  updateResourceUsage,
  generateSlotKey,
  type ScoringContext,
} from './scoring.js';
import {
  rotateArray,
  shuffleWithSeed,
  generateWeekDefinitions,
  initializeTeamState,
  updateTeamStateAfterScheduling,
  generateCandidatesForTeamEvent,
  generateCandidatesForGame,
  selectBestCandidate,
  candidateToEventDraft,
  getWeekNumberForDate,
  teamNeedsEventInWeek,
  anyTeamNeedsEventInWeek,
  parseLocalDate,
  formatDateStr,
} from './draft.js';

/**
 * Main schedule generator
 * Generates optimal schedules for games, practices, and cage sessions
 * Uses season.gamesStartDate to determine when games can be scheduled
 * Practices and cages can be scheduled from season.startDate to season.endDate
 */
export class ScheduleGenerator {
  private season: Season;
  private divisionConfigs: Map<string, DivisionConfig>;
  private divisionNames: Map<string, string>; // divisionId -> divisionName
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

  // Resource slots
  private gameFieldSlots: ResourceSlot[] = [];
  private practiceFieldSlots: ResourceSlot[] = [];
  private cageSlots: ResourceSlot[] = [];

  private teamConstraints: Map<string, TeamConstraint> = new Map();
  private scheduledEvents: ScheduledEventDraft[] = [];
  private errors: ScheduleError[] = [];
  private warnings: ScheduleWarning[] = [];
  private schedulingLog: SchedulingLogEntry[] = [];

  // Draft-based scheduling state
  private teamSchedulingStates: Map<string, TeamSchedulingState> = new Map();
  private scoringContext: ScoringContext | null = null;
  private scoringWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS;
  private weekDefinitions: WeekDefinition[] = [];
  private randomSeed: number = Date.now();

  // Day names for logging
  private static readonly DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  constructor(
    season: Season,
    divisions: Division[],
    divisionConfigs: DivisionConfig[],
    teams: Team[],
    seasonFields: SeasonField[],
    seasonCages: SeasonCage[],
    fieldAvailability: FieldAvailability[],
    cageAvailability: CageAvailability[],
    fieldOverrides: FieldDateOverride[],
    cageOverrides: CageDateOverride[]
  ) {
    this.season = season;
    this.divisionConfigs = new Map(divisionConfigs.map((dc) => [dc.divisionId, dc]));
    this.divisionNames = new Map(divisions.map((d) => [d.id, d.name]));
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
  }

  /**
   * Get the effective games start date for the season
   * Falls back to season start date if gamesStartDate is not set
   */
  private getGamesStartDate(): string {
    return this.season.gamesStartDate || this.season.startDate;
  }

  /**
   * Add an entry to the scheduling log
   */
  private log(
    level: SchedulingLogEntry['level'],
    category: SchedulingLogEntry['category'],
    message: string,
    details?: SchedulingLogEntry['details'],
    summary?: string
  ): void {
    this.schedulingLog.push({
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      summary,
      details,
    });
    // Also console.log for server-side debugging
    const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
    console.log(`[${level.toUpperCase()}] [${category}] ${message}${detailsStr}`);
  }

  /**
   * Get a resource name (field or cage) by its ID
   */
  private getResourceName(resourceId: string, resourceType: 'field' | 'cage'): string {
    if (resourceType === 'field') {
      const seasonField = this.seasonFields.find(sf => sf.fieldId === resourceId);
      return seasonField?.field?.name || seasonField?.fieldName || resourceId;
    } else {
      const seasonCage = this.seasonCages.find(sc => sc.cageId === resourceId);
      return seasonCage?.cage?.name || seasonCage?.cageName || resourceId;
    }
  }

  /**
   * Generate a human-readable summary for why no slots were available for an event
   */
  private generateNoSlotsAvailableSummary(
    teamState: TeamSchedulingState,
    eventType: 'practice' | 'cage',
    week: WeekDefinition,
    weekSlots: ResourceSlot[],
    requiredDuration: number,
    scheduledEventsThisWeek: ScheduledEventDraft[]
  ): string {
    const lines: string[] = [];
    const teamName = `${teamState.teamName} (${teamState.divisionName})`;
    const resourceType = eventType === 'cage' ? 'cage' : 'field';
    const datesUsed = eventType === 'cage' ? teamState.cageDatesUsed : teamState.fieldDatesUsed;

    // Check if team already has an event this week
    const teamEventsThisWeek = scheduledEventsThisWeek.filter(e =>
      e.teamId === teamState.teamId || e.homeTeamId === teamState.teamId || e.awayTeamId === teamState.teamId
    );
    const teamEventDatesThisWeek = new Set(teamEventsThisWeek.map(e => e.date));
    const teamEventDatesInWeek = week.dates.filter(d => datesUsed.has(d));

    if (weekSlots.length === 0) {
      lines.push(`No ${resourceType} slots available during week ${week.weekNumber + 1} (${week.startDate} to ${week.endDate}).`);
      lines.push(`This may indicate missing ${resourceType} availability configuration for this time period.`);
    } else {
      lines.push(`Week ${week.weekNumber + 1} (${week.startDate} to ${week.endDate}):`);

      // Explain team's existing schedule conflicts
      if (teamEventDatesInWeek.length > 0) {
        const dateList = teamEventDatesInWeek.sort().join(', ');
        lines.push(`  Team already has ${resourceType} events on: ${dateList}`);
      }

      // Count available slots by date and show what's blocking them
      const slotsByDate = new Map<string, ResourceSlot[]>();
      for (const slot of weekSlots) {
        if (!slotsByDate.has(slot.slot.date)) {
          slotsByDate.set(slot.slot.date, []);
        }
        slotsByDate.get(slot.slot.date)!.push(slot);
      }

      const availableDates = Array.from(slotsByDate.keys()).filter(d => !datesUsed.has(d)).sort();
      if (availableDates.length === 0) {
        lines.push(`  All dates with ${resourceType} availability conflict with team's existing schedule`);
      } else {
        // Check what's scheduled on available dates
        const conflictDetails: string[] = [];
        for (const date of availableDates) {
          const slots = slotsByDate.get(date)!;
          const eventsOnDate = scheduledEventsThisWeek.filter(e => e.date === date && (e.fieldId || e.cageId));
          const usedResources = new Set(eventsOnDate.map(e => e.fieldId || e.cageId));

          // Check if all slots are either too short or have resource conflicts
          const tooShort = slots.filter(s => s.slot.duration < requiredDuration);
          const availableResources = slots.filter(s => s.slot.duration >= requiredDuration && !usedResources.has(s.resourceId));

          if (tooShort.length === slots.length) {
            conflictDetails.push(`${date}: all slots shorter than ${requiredDuration}h required`);
          } else if (availableResources.length === 0) {
            // Get resource names from our lookup helper
            const resourceNames = [...new Set(eventsOnDate.map(e => {
              const resId = e.fieldId || e.cageId;
              if (!resId) return 'unknown';
              return this.getResourceName(resId, e.fieldId ? 'field' : 'cage');
            }))].join(', ');
            conflictDetails.push(`${date}: ${resourceType}s fully booked (${resourceNames})`);
          }
        }

        if (conflictDetails.length > 0) {
          lines.push(`  Remaining dates are blocked:`);
          conflictDetails.forEach(d => lines.push(`    • ${d}`));
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Check if a date is within the games period
   */
  private isGameDateAllowed(date: string): boolean {
    return date >= this.getGamesStartDate() && date <= this.season.endDate;
  }

  /**
   * Check if a date is within the practice/cage period (full season)
   */
  private isPracticeDateAllowed(date: string): boolean {
    return date >= this.season.startDate && date <= this.season.endDate;
  }

  /**
   * Generate the schedule
   */
  async generate(): Promise<GenerateScheduleResult> {
    try {
      console.log('='.repeat(80));
      console.log('SCHEDULE GENERATION STARTED');
      console.log(`Season: ${this.season.name}`);
      console.log(`  Full season: ${this.season.startDate} to ${this.season.endDate}`);
      console.log(`  Games period: ${this.getGamesStartDate()} to ${this.season.endDate}`);
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

      // Step 3.5: Initialize draft-based scheduling
      this.initializeDraftScheduling();
      console.log(`✓ Initialized draft scheduling with ${this.weekDefinitions.length} weeks`);

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
   * Build all available resource slots based on season dates
   * Games can only be scheduled from gamesStartDate
   * Practices and cages can be scheduled for the full season
   */
  private buildResourceSlots(): void {
    this.log('info', 'general', 'Building resource slots');

    const allDates = getDateRange(this.season.startDate, this.season.endDate);

    // Build game field slots for dates from gamesStartDate onwards
    const gameDates = allDates.filter(date => this.isGameDateAllowed(date));
    this.buildFieldSlotsForDates(gameDates, this.gameFieldSlots);

    // Build practice field slots for all season dates
    const practiceDates = allDates.filter(date => this.isPracticeDateAllowed(date));
    this.buildFieldSlotsForDates(practiceDates, this.practiceFieldSlots);

    // Build cage slots for all season dates
    const cageDates = allDates.filter(date => this.isPracticeDateAllowed(date));
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
    const totalWeeks = this.calculateDurationWeeks(this.season.startDate, this.season.endDate);

    // Calculate weeks where each event type is allowed
    const allDates = getDateRange(this.season.startDate, this.season.endDate);
    const gameDates = allDates.filter(date => this.isGameDateAllowed(date));
    const practiceDates = allDates.filter(date => this.isPracticeDateAllowed(date));
    const cageDates = allDates.filter(date => this.isPracticeDateAllowed(date));

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
   * Initialize draft-based scheduling structures
   */
  private initializeDraftScheduling(): void {
    // Build week definitions
    this.weekDefinitions = generateWeekDefinitions(this.season.startDate, this.season.endDate);

    // Initialize team scheduling states
    for (const team of this.teams) {
      const config = this.divisionConfigs.get(team.divisionId);
      if (!config) continue;

      const constraint = this.teamConstraints.get(team.id);
      if (!constraint) continue;

      const divisionName = this.divisionNames.get(team.divisionId) || 'Unknown';
      const state = initializeTeamState(team.id, team.name, team.divisionId, divisionName, {
        totalGamesNeeded: constraint.requiredGames || 0,
        totalPracticesNeeded: constraint.requiredPractices || 0,
        totalCagesNeeded: constraint.requiredCageSessions || 0,
        minDaysBetweenEvents: constraint.minDaysBetweenEvents || 0,
      });

      this.teamSchedulingStates.set(team.id, state);
    }

    // Initialize scoring context
    this.scoringContext = createScoringContext();
    this.scoringContext.teamStates = this.teamSchedulingStates;
    this.scoringContext.weekDefinitions = this.weekDefinitions.map((w) => ({
      weekNumber: w.weekNumber,
      startDate: w.startDate,
      endDate: w.endDate,
    }));
    this.scoringContext.scheduledEvents = this.scheduledEvents;

    // Set up division configs for scoring
    for (const [divisionId, config] of this.divisionConfigs) {
      this.scoringContext.divisionConfigs.set(divisionId, {
        practicesPerWeek: config.practicesPerWeek,
        gamesPerWeek: config.gamesPerWeek || 0,
        cageSessionsPerWeek: config.cageSessionsPerWeek || 0,
      });

      // Set up game day preferences
      if (config.gameDayPreferences) {
        this.scoringContext.gameDayPreferences.set(divisionId, config.gameDayPreferences);
      }

      // Set up field preferences
      if (config.fieldPreferences) {
        this.scoringContext.fieldPreferences.set(divisionId, config.fieldPreferences);
      }
    }

    // Set up resource capacities (approximate based on availability hours)
    for (const sf of this.seasonFields) {
      // Estimate capacity as 10 hours per day
      this.scoringContext.resourceCapacity.set(sf.fieldId, 10);
    }
    for (const sc of this.seasonCages) {
      this.scoringContext.resourceCapacity.set(sc.cageId, 10);
    }

    this.log('info', 'general', 'Initialized draft-based scheduling', {
      teams: this.teamSchedulingStates.size,
      weeks: this.weekDefinitions.length,
    });
  }

  /**
   * Calculate duration in weeks between two dates
   */
  private calculateDurationWeeks(startDate: string, endDate: string): number {
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(1, Math.ceil(days / 7));
  }

  /**
   * Get all weeks within the season date range
   */
  private getWeeksInSeason(): Array<{ startDate: string; endDate: string }> {
    return this.getWeeksInRange(this.season.startDate, this.season.endDate);
  }

  /**
   * Get weeks where a specific event type is allowed
   */
  private getWeeksForEventType(eventType: EventType): Array<{ startDate: string; endDate: string }> {
    if (eventType === 'game') {
      // Games can only be scheduled from gamesStartDate onwards
      return this.getWeeksInRange(this.getGamesStartDate(), this.season.endDate);
    } else {
      // Practices and cages can be scheduled for the full season
      return this.getWeeksInRange(this.season.startDate, this.season.endDate);
    }
  }

  /**
   * Get all weeks within a date range
   */
  private getWeeksInRange(startDate: string, endDate: string): Array<{ startDate: string; endDate: string }> {
    const weeks: Array<{ startDate: string; endDate: string }> = [];
    const rangeStart = parseLocalDate(startDate);
    const rangeEnd = parseLocalDate(endDate);

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
        startDate: formatDateStr(currentWeekStart),
        endDate: formatDateStr(currentWeekEnd),
      });

      // Move to next week
      currentWeekStart = new Date(currentWeekEnd);
      currentWeekStart.setDate(currentWeekStart.getDate() + 1);
    }

    return weeks;
  }

  /**
   * Schedule games using draft-based allocation for fair distribution
   */
  private async scheduleGames(): Promise<void> {
    console.log('\n--- Scheduling Games (Draft-Based) ---');
    this.log('info', 'game', 'Starting draft-based game scheduling phase');

    if (!this.scoringContext) {
      throw new Error('Scoring context not initialized');
    }

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

    // Get weeks where games are allowed (any date >= gamesStartDate)
    const gameWeeks = this.weekDefinitions.filter((week) =>
      week.dates.some((date) => this.isGameDateAllowed(date))
    );
    console.log(`Total weeks for games: ${gameWeeks.length}`);

    // Build division info for game scheduling
    const divisionTeamsList: Array<{ divisionId: string; teams: Team[]; config: { gamesPerWeek: number; gameDurationHours: number } }> = [];
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

      divisionTeamsList.push({
        divisionId,
        teams: divisionTeams,
        config: { gamesPerWeek: config.gamesPerWeek, gameDurationHours: config.gameDurationHours },
      });
    }

    // Track opponent history: teamId -> opponentId -> array of dates played
    const opponentHistory = new Map<string, Map<string, string[]>>();
    for (const division of divisionTeamsList) {
      for (const team of division.teams) {
        opponentHistory.set(team.id, new Map());
        // Initialize with all opponents in the division
        for (const opponent of division.teams) {
          if (opponent.id !== team.id) {
            opponentHistory.get(team.id)!.set(opponent.id, []);
          }
        }
      }
    }

    // Helper to get days since last game against opponent
    const getDaysSinceLastGame = (teamId: string, opponentId: string, currentDate: string): number => {
      const history = opponentHistory.get(teamId)?.get(opponentId) || [];
      if (history.length === 0) return Infinity; // Never played
      const lastDate = history[history.length - 1];
      const last = parseLocalDate(lastDate);
      const current = parseLocalDate(currentDate);
      return Math.floor((current.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
    };

    // Helper to record a game between two teams
    const recordGame = (team1Id: string, team2Id: string, date: string) => {
      opponentHistory.get(team1Id)?.get(team2Id)?.push(date);
      opponentHistory.get(team2Id)?.get(team1Id)?.push(date);
    };

    // Helper to schedule a single game between two teams
    const tryScheduleGame = (
      team: Team,
      opponent: Team,
      divisionId: string,
      config: { gamesPerWeek: number; gameDurationHours: number },
      week: WeekDefinition
    ): boolean => {
      const teamState = this.teamSchedulingStates.get(team.id);
      const opponentState = this.teamSchedulingStates.get(opponent.id);
      if (!teamState || !opponentState) return false;

      // Filter field slots to this week and compatible with division
      const weekFieldSlots = this.gameFieldSlots.filter((rs) =>
        week.dates.includes(rs.slot.date) &&
        this.isFieldCompatibleWithDivision(rs.resourceId, divisionId)
      );

      if (weekFieldSlots.length === 0) {
        this.log('warning', 'game', `No compatible field slots for ${team.name} vs ${opponent.name} in week ${week.weekNumber}`, {
          teamName: team.name,
          opponentName: opponent.name,
          divisionId,
          weekNumber: week.weekNumber,
          reason: 'no_compatible_field_slots',
        });
        return false;
      }

      // Create a matchup object
      const matchup: GameMatchup = {
        homeTeamId: team.id,
        awayTeamId: opponent.id,
        divisionId,
      };

      // Generate placement candidates for this game
      const candidates = generateCandidatesForGame(
        matchup,
        weekFieldSlots,
        week,
        config.gameDurationHours,
        this.season.id,
        this.scoringContext!
      );

      if (candidates.length === 0) {
        this.log('warning', 'game', `No valid time slots for ${team.name} vs ${opponent.name} in week ${week.weekNumber}`, {
          teamName: team.name,
          opponentName: opponent.name,
          weekNumber: week.weekNumber,
          availableFieldSlots: weekFieldSlots.length,
          reason: 'all_slots_have_conflicts',
        });
        return false;
      }

      // Score all candidates
      const scoredCandidates = candidates.map((c) =>
        calculatePlacementScore(c, teamState, this.scoringContext!, this.scoringWeights)
      );
      scoredCandidates.sort((a, b) => b.score - a.score);
      const bestCandidate = scoredCandidates[0];

      if (!bestCandidate) return false;

      // Check if best candidate has severe penalty (sameDayEvent)
      // Score below -500000 means both teams already have field events that day
      if (bestCandidate.score < -500000) {
        const teamFieldDates = Array.from(teamState.fieldDatesUsed);
        const opponentFieldDates = Array.from(opponentState.fieldDatesUsed);
        this.log('warning', 'game', `All slots have same-day conflicts for ${team.name} vs ${opponent.name} in week ${week.weekNumber}`, {
          teamName: team.name,
          opponentName: opponent.name,
          weekNumber: week.weekNumber,
          teamFieldDates: teamFieldDates.filter(d => week.dates.includes(d)),
          opponentFieldDates: opponentFieldDates.filter(d => week.dates.includes(d)),
          bestScore: bestCandidate.score,
          reason: 'same_day_conflicts',
        });
        return false;
      }

      // Create the event draft
      const eventDraft = candidateToEventDraft(bestCandidate, divisionId);
      this.scheduledEvents.push(eventDraft);
      this.scoringContext!.scheduledEvents = this.scheduledEvents;

      // Update both team states
      const isHomeTeam = bestCandidate.homeTeamId === teamState.teamId;
      updateTeamStateAfterScheduling(teamState, eventDraft, week.weekNumber, isHomeTeam, opponentState.teamId);
      updateTeamStateAfterScheduling(opponentState, eventDraft, week.weekNumber, !isHomeTeam, teamState.teamId);

      // Update resource usage
      updateResourceUsage(this.scoringContext!, bestCandidate.resourceId, bestCandidate.date, config.gameDurationHours);

      // Record the game in opponent history
      recordGame(team.id, opponent.id, bestCandidate.date);

      const homeTeam = this.teams.find((t) => t.id === bestCandidate.homeTeamId);
      const awayTeam = this.teams.find((t) => t.id === bestCandidate.awayTeamId);
      const dayName = ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek];

      console.log(`    ✅ ${homeTeam?.name || 'Team'} vs ${awayTeam?.name || 'Team'}: ${bestCandidate.date} (${dayName}) ${bestCandidate.startTime}-${bestCandidate.endTime} @ ${bestCandidate.resourceName} (score: ${bestCandidate.score.toFixed(1)})`);

      this.log('info', 'game', `Scheduled game: ${homeTeam?.name} vs ${awayTeam?.name}`, {
        homeTeamId: bestCandidate.homeTeamId,
        awayTeamId: bestCandidate.awayTeamId,
        date: bestCandidate.date,
        dayOfWeek: bestCandidate.dayOfWeek,
        dayName,
        time: `${bestCandidate.startTime}-${bestCandidate.endTime}`,
        resourceName: bestCandidate.resourceName,
        score: bestCandidate.score,
        scoreBreakdown: bestCandidate.scoreBreakdown,
      });

      return true;
    };

    // Schedule games week by week using draft approach
    // The high gameDayPreference weight (500) ensures required/preferred days are chosen
    let totalScheduled = 0;

    for (const week of gameWeeks) {
      console.log(`\nWeek ${week.weekNumber + 1} (${week.startDate} to ${week.endDate}):`);

      let gamesScheduledThisWeek = 0;
      let round = 0;
      const maxRounds = 50; // Safety limit

      while (round < maxRounds) {
        // Find teams that still need games this week, grouped by division
        const teamsNeedingGames: Array<{ team: Team; divisionId: string; config: { gamesPerWeek: number; gameDurationHours: number }; gamesThisWeek: number }> = [];

        for (const division of divisionTeamsList) {
          for (const team of division.teams) {
            const teamState = this.teamSchedulingStates.get(team.id);
            if (!teamState) continue;
            const gamesThisWeek = teamState.eventsPerWeek.get(week.weekNumber)?.games || 0;
            if (gamesThisWeek < division.config.gamesPerWeek) {
              teamsNeedingGames.push({
                team,
                divisionId: division.divisionId,
                config: division.config,
                gamesThisWeek,
              });
            }
          }
        }

        if (teamsNeedingGames.length === 0) {
          console.log(`  All teams have met their weekly game quota`);
          break;
        }

        // Sort by fewest games scheduled this week (give priority to teams that need games most)
        teamsNeedingGames.sort((a, b) => a.gamesThisWeek - b.gamesThisWeek);

        let anyScheduledThisRound = false;

        // Try to schedule a game for each team that needs one
        for (const { team, divisionId, config } of teamsNeedingGames) {
          const teamState = this.teamSchedulingStates.get(team.id);
          if (!teamState) continue;

          // Re-check if team still needs a game (may have been scheduled as opponent)
          const gamesThisWeek = teamState.eventsPerWeek.get(week.weekNumber)?.games || 0;
          if (gamesThisWeek >= config.gamesPerWeek) continue;

          // Find potential opponents in the same division who also need games
          const divisionInfo = divisionTeamsList.find((d) => d.divisionId === divisionId);
          if (!divisionInfo) continue;

          const potentialOpponents: Array<{ opponent: Team; daysSinceLastGame: number; opponentGamesThisWeek: number }> = [];

          for (const opponent of divisionInfo.teams) {
            if (opponent.id === team.id) continue;

            const opponentState = this.teamSchedulingStates.get(opponent.id);
            if (!opponentState) continue;

            const opponentGamesThisWeek = opponentState.eventsPerWeek.get(week.weekNumber)?.games || 0;
            if (opponentGamesThisWeek >= config.gamesPerWeek) continue;

            // Calculate days since they last played each other
            const daysSinceLastGame = getDaysSinceLastGame(team.id, opponent.id, week.startDate);

            potentialOpponents.push({
              opponent,
              daysSinceLastGame,
              opponentGamesThisWeek,
            });
          }

          if (potentialOpponents.length === 0) {
            // No eligible opponents for this team this week
            continue;
          }

          // Sort opponents: prefer those we haven't played recently, then those who need games most
          potentialOpponents.sort((a, b) => {
            // Primary: days since last game (higher is better - haven't played recently)
            if (a.daysSinceLastGame !== b.daysSinceLastGame) {
              return b.daysSinceLastGame - a.daysSinceLastGame;
            }
            // Secondary: opponent needs games more (lower gamesThisWeek is better)
            return a.opponentGamesThisWeek - b.opponentGamesThisWeek;
          });

          // Try to schedule with the best opponent
          let scheduled = false;
          for (const { opponent } of potentialOpponents) {
            const opponentState = this.teamSchedulingStates.get(opponent.id);
            if (!opponentState) continue;

            // Re-check opponent still needs a game
            const opponentGamesThisWeek = opponentState.eventsPerWeek.get(week.weekNumber)?.games || 0;
            if (opponentGamesThisWeek >= config.gamesPerWeek) continue;

            if (tryScheduleGame(team, opponent, divisionId, config, week)) {
              totalScheduled++;
              gamesScheduledThisWeek++;
              anyScheduledThisRound = true;
              scheduled = true;
              break; // Move to next team
            }
          }

          if (!scheduled) {
            this.log('debug', 'game', `Could not find valid slot for ${team.name} in week ${week.weekNumber + 1}`, {
              teamId: team.id,
              teamName: team.name,
              weekNumber: week.weekNumber + 1,
              potentialOpponentsChecked: potentialOpponents.length,
            });
          }
        }

        if (!anyScheduledThisRound) {
          // No games could be scheduled this round
          const stillNeedingGames = teamsNeedingGames.filter((t) => {
            const state = this.teamSchedulingStates.get(t.team.id);
            const games = state?.eventsPerWeek.get(week.weekNumber)?.games || 0;
            return games < t.config.gamesPerWeek;
          });
          if (stillNeedingGames.length > 0) {
            console.log(`  ⚠️  Teams still need games but no slots available:`);
            for (const { team, config } of stillNeedingGames) {
              const state = this.teamSchedulingStates.get(team.id);
              const games = state?.eventsPerWeek.get(week.weekNumber)?.games || 0;
              console.log(`      - ${team.name}: ${games}/${config.gamesPerWeek} games`);
            }
            this.log('warning', 'game', `Teams need games but no slots available in week ${week.weekNumber + 1}`, {
              weekNumber: week.weekNumber + 1,
              teamsNeedingGames: stillNeedingGames.map((t) => ({
                teamName: t.team.name,
                gamesThisWeek: this.teamSchedulingStates.get(t.team.id)?.eventsPerWeek.get(week.weekNumber)?.games || 0,
                target: t.config.gamesPerWeek,
              })),
            });
          }
          break;
        }

        round++;
      }

      console.log(`  Scheduled ${gamesScheduledThisWeek} games this week`);
    }

    // Report any teams that didn't get all their games for the season
    for (const division of divisionTeamsList) {
      for (const team of division.teams) {
        const teamState = this.teamSchedulingStates.get(team.id);
        if (!teamState) continue;

        const totalNeeded = division.config.gamesPerWeek * gameWeeks.length;
        if (teamState.gamesScheduled < totalNeeded) {
          this.log('error', 'game', `Game requirement not met for ${team.name}: ${teamState.gamesScheduled}/${totalNeeded} games scheduled`, {
            teamId: team.id,
            teamName: team.name,
            divisionId: division.divisionId,
            gamesScheduled: teamState.gamesScheduled,
            gamesNeeded: totalNeeded,
            gamesPerWeek: division.config.gamesPerWeek,
            totalWeeks: gameWeeks.length,
            shortfall: totalNeeded - teamState.gamesScheduled,
            homeGames: teamState.homeGames,
            awayGames: teamState.awayGames,
          });
        }
      }
    }

    const totalGames = this.scheduledEvents.filter((e) => e.eventType === 'game').length;
    console.log(`\n✅ Game scheduling complete. Total scheduled: ${totalGames}`);
  }

  /**
   * Schedule practices for all teams using draft-based allocation
   * Round-robin ensures fair distribution of slots across teams
   */
  private async schedulePractices(): Promise<void> {
    console.log('\n--- Scheduling Practices (Draft-Based) ---');
    console.log(`Total teams: ${this.teams.length}`);
    this.log('info', 'practice', 'Starting draft-based practice scheduling phase');

    if (!this.scoringContext) {
      throw new Error('Scoring context not initialized');
    }

    // Get the WeekDefinitions that have practice dates (all season dates are practice dates)
    const practiceWeeks = this.weekDefinitions.filter((week) =>
      week.dates.some((date) => this.isPracticeDateAllowed(date))
    );
    console.log(`Total weeks for practices: ${practiceWeeks.length}`);
    this.log('info', 'practice', `Scheduling practices across ${practiceWeeks.length} weeks using draft allocation`, {
      firstWeek: practiceWeeks[0]?.startDate,
      lastWeek: practiceWeeks[practiceWeeks.length - 1]?.endDate,
    });

    // Get field slots compatible with practices
    const practiceFieldSlots = this.practiceFieldSlots;

    // Process week by week
    for (const week of practiceWeeks) {
      console.log(`\nWeek ${week.weekNumber + 1} (${week.startDate} to ${week.endDate}):`);

      // Get teams that need practices this week, sorted by who is furthest behind their target
      const teamsNeedingPractices = Array.from(this.teamSchedulingStates.values())
        .filter((ts) => {
          const config = this.divisionConfigs.get(ts.divisionId);
          if (!config) return false;
          return teamNeedsEventInWeek(ts, 'practice', week.weekNumber, {
            practicesPerWeek: config.practicesPerWeek,
            gamesPerWeek: config.gamesPerWeek || 0,
            cageSessionsPerWeek: config.cageSessionsPerWeek || 0,
          });
        })
        .sort((a, b) => {
          // Sort by who is furthest behind: (scheduled - expected) ascending
          // Expected = (week.weekNumber) * practicesPerWeek (practices we should have by now)
          const configA = this.divisionConfigs.get(a.divisionId);
          const configB = this.divisionConfigs.get(b.divisionId);
          const expectedA = week.weekNumber * (configA?.practicesPerWeek || 1);
          const expectedB = week.weekNumber * (configB?.practicesPerWeek || 1);
          const deficitA = expectedA - a.practicesScheduled;
          const deficitB = expectedB - b.practicesScheduled;
          // Higher deficit = more behind = should go first (sort descending by deficit)
          return deficitB - deficitA;
        });

      // Rotate starting position based on week number for additional fairness
      const rotatedByWeek = rotateArray(teamsNeedingPractices, week.weekNumber);

      if (rotatedByWeek.length === 0) {
        console.log('  No teams need practices this week');
        continue;
      }

      // Check capacity: count total practice slots needed vs available
      let totalPracticesNeeded = 0;
      for (const ts of teamsNeedingPractices) {
        const config = this.divisionConfigs.get(ts.divisionId);
        if (config) {
          const weekEvents = ts.eventsPerWeek.get(week.weekNumber) || { games: 0, practices: 0, cages: 0 };
          totalPracticesNeeded += config.practicesPerWeek - weekEvents.practices;
        }
      }

      // Count available slots in this week (unique date+time+resource combinations)
      const weekSlots = practiceFieldSlots.filter((rs) => week.dates.includes(rs.slot.date));
      const uniqueSlotKeys = new Set(weekSlots.map(s => `${s.slot.date}|${s.slot.startTime}|${s.resourceId}`));
      const availableSlots = uniqueSlotKeys.size;

      console.log(`  Capacity check: ${totalPracticesNeeded} practices needed, ${availableSlots} unique slots available`);

      if (availableSlots < totalPracticesNeeded) {
        this.log('warning', 'practice', `Insufficient practice capacity in week ${week.weekNumber + 1}`, {
          weekNumber: week.weekNumber + 1,
          weekStart: week.startDate,
          weekEnd: week.endDate,
          practicesNeeded: totalPracticesNeeded,
          slotsAvailable: availableSlots,
          teamsNeedingPractices: teamsNeedingPractices.length,
          shortfall: totalPracticesNeeded - availableSlots,
          datesWithSlots: [...new Set(weekSlots.map(s => s.slot.date))].sort(),
        });
        console.log(`  ⚠️  CAPACITY WARNING: Need ${totalPracticesNeeded} practices but only ${availableSlots} slots available (shortfall: ${totalPracticesNeeded - availableSlots})`);
      }

      // Draft rounds - keep going until no team needs more practices this week
      let round = 0;
      const maxRounds = 10; // Safety limit

      while (round < maxRounds) {
        // Check if any team still needs a practice this week, prioritizing those furthest behind
        const stillNeedPractices = rotatedByWeek
          .filter((ts) => {
            const config = this.divisionConfigs.get(ts.divisionId);
            if (!config) return false;
            return teamNeedsEventInWeek(ts, 'practice', week.weekNumber, {
              practicesPerWeek: config.practicesPerWeek,
              gamesPerWeek: config.gamesPerWeek || 0,
              cageSessionsPerWeek: config.cageSessionsPerWeek || 0,
            });
          })
          .sort((a, b) => {
            // Re-sort by current deficit (may have changed since last round)
            const configA = this.divisionConfigs.get(a.divisionId);
            const configB = this.divisionConfigs.get(b.divisionId);
            const expectedA = (week.weekNumber + 1) * (configA?.practicesPerWeek || 1);
            const expectedB = (week.weekNumber + 1) * (configB?.practicesPerWeek || 1);
            const deficitA = expectedA - a.practicesScheduled;
            const deficitB = expectedB - b.practicesScheduled;
            return deficitB - deficitA;
          });

        if (stillNeedPractices.length === 0) {
          console.log(`  All teams met practice requirements for this week`);
          break;
        }

        // Compute slot availability for scarcity calculation
        this.computeTeamSlotAvailability(stillNeedPractices, practiceFieldSlots, week);

        // Rotate team order within round for fairness among teams with similar deficits
        const rotatedTeams = rotateArray(stillNeedPractices, round);
        console.log(`  Round ${round + 1}: ${rotatedTeams.length} teams still need practices`);

        let anyScheduledThisRound = false;

        for (const teamState of rotatedTeams) {
          const config = this.divisionConfigs.get(teamState.divisionId);
          if (!config) continue;

          // Check if this team still needs a practice this week
          if (!teamNeedsEventInWeek(teamState, 'practice', week.weekNumber, {
            practicesPerWeek: config.practicesPerWeek,
            gamesPerWeek: config.gamesPerWeek || 0,
            cageSessionsPerWeek: config.cageSessionsPerWeek || 0,
          })) {
            continue;
          }

          // Filter slots to this week and compatible with division
          const weekSlots = practiceFieldSlots.filter((rs) =>
            week.dates.includes(rs.slot.date) &&
            this.isFieldCompatibleWithDivision(rs.resourceId, teamState.divisionId)
          );

          // Generate placement candidates - enable logging when no candidates found
          let candidates = generateCandidatesForTeamEvent(
            teamState,
            'practice',
            weekSlots,
            week,
            config.practiceDurationHours,
            this.season.id,
            this.scoringContext,
            false // Initial call without logging
          );

          if (candidates.length === 0) {
            // Re-run with logging enabled to understand why
            console.log(`    ${teamState.teamName}: No candidates available - investigating...`);
            console.log(`      Week slots available: ${weekSlots.length}`);
            console.log(`      Practice duration required: ${config.practiceDurationHours}h`);

            // Re-run with logging to get detailed breakdown
            candidates = generateCandidatesForTeamEvent(
              teamState,
              'practice',
              weekSlots,
              week,
              config.practiceDurationHours,
              this.season.id,
              this.scoringContext,
              true // Enable detailed logging
            );

            // Find what events are already scheduled in this week
            const eventsThisWeek = this.scheduledEvents.filter(e => week.dates.includes(e.date));
            const practicesThisWeek = eventsThisWeek.filter(e => e.eventType === 'practice');

            // Generate human-readable summary
            const summary = this.generateNoSlotsAvailableSummary(
              teamState,
              'practice',
              week,
              weekSlots,
              config.practiceDurationHours,
              eventsThisWeek
            );

            // Log at error level for easy filtering
            this.log('error', 'practice', `No practice slots available for ${teamState.teamName} (${teamState.divisionName}) in week ${week.weekNumber + 1}`, {
              teamId: teamState.teamId,
              teamName: teamState.teamName,
              divisionName: teamState.divisionName,
              weekNumber: week.weekNumber + 1,
              weekStart: week.startDate,
              weekEnd: week.endDate,
              weekSlotsCount: weekSlots.length,
              requiredDuration: config.practiceDurationHours,
              fieldDatesUsed: Array.from(teamState.fieldDatesUsed).sort(),
              cageDatesUsed: Array.from(teamState.cageDatesUsed).sort(),
              eventsAlreadyScheduledThisWeek: eventsThisWeek.length,
              practicesAlreadyScheduledThisWeek: practicesThisWeek.length,
              scheduledPracticeDetails: practicesThisWeek.map(p => ({
                teamId: p.teamId,
                teamName: this.teamSchedulingStates.get(p.teamId || '')?.teamName || 'unknown',
                date: p.date,
                time: `${p.startTime}-${p.endTime}`,
                fieldId: p.fieldId,
              })),
              reason: weekSlots.length === 0
                ? 'No compatible field slots available this week'
                : 'All available slots conflict with existing events or team schedule',
            }, summary);
            continue;
          }

          // Score and select the best candidate
          const bestCandidate = selectBestCandidate(
            candidates,
            teamState,
            this.scoringContext,
            this.scoringWeights
          );

          if (!bestCandidate) {
            console.log(`    ${teamState.teamName}: No valid candidate found`);
            continue;
          }

          // Convert to event draft and add to scheduled events
          const eventDraft = candidateToEventDraft(bestCandidate, teamState.divisionId);
          this.scheduledEvents.push(eventDraft);
          this.scoringContext.scheduledEvents = this.scheduledEvents;

          // Update team state
          updateTeamStateAfterScheduling(teamState, eventDraft, week.weekNumber);

          // Update resource usage in scoring context
          const durationHours = config.practiceDurationHours;
          updateResourceUsage(this.scoringContext, bestCandidate.resourceId, bestCandidate.date, durationHours);

          const dayName = ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek];
          console.log(`    ✅ ${teamState.teamName}: ${bestCandidate.date} (${dayName}) ${bestCandidate.startTime}-${bestCandidate.endTime} @ ${bestCandidate.resourceName} (score: ${bestCandidate.score.toFixed(1)})`);

          this.log('info', 'practice', `Scheduled practice for ${teamState.teamName}`, {
            teamId: teamState.teamId,
            teamName: teamState.teamName,
            date: bestCandidate.date,
            dayOfWeek: bestCandidate.dayOfWeek,
            dayName,
            time: `${bestCandidate.startTime}-${bestCandidate.endTime}`,
            resourceName: bestCandidate.resourceName,
            score: bestCandidate.score,
            scoreBreakdown: bestCandidate.scoreBreakdown,
          });

          anyScheduledThisRound = true;
        }

        if (!anyScheduledThisRound) {
          console.log(`  No practices scheduled this round, moving to next week`);
          // Log which teams still needed practices but couldn't get any
          const unscheduledTeams = teamsNeedingPractices.filter((ts) => {
            const cfg = this.divisionConfigs.get(ts.divisionId);
            if (!cfg) return false;
            return teamNeedsEventInWeek(ts, 'practice', week.weekNumber, {
              practicesPerWeek: cfg.practicesPerWeek,
              gamesPerWeek: cfg.gamesPerWeek || 0,
              cageSessionsPerWeek: cfg.cageSessionsPerWeek || 0,
            });
          });
          if (unscheduledTeams.length > 0) {
            console.log(`  ⚠️  Teams that still need practices this week but couldn't be scheduled:`);
            for (const ts of unscheduledTeams) {
              const weekEvents = ts.eventsPerWeek.get(week.weekNumber) || { games: 0, practices: 0, cages: 0 };
              const cfg = this.divisionConfigs.get(ts.divisionId);
              console.log(`      - ${ts.teamName}: has ${weekEvents.practices}/${cfg?.practicesPerWeek || '?'} practices, field dates: [${Array.from(ts.fieldDatesUsed).sort().join(', ')}]`);

              // Log at error level for easy filtering
              this.log('error', 'practice', `Failed to schedule practice for ${ts.teamName} in week ${week.weekNumber + 1}`, {
                teamId: ts.teamId,
                teamName: ts.teamName,
                weekNumber: week.weekNumber + 1,
                weekStart: week.startDate,
                weekEnd: week.endDate,
                practicesScheduledThisWeek: weekEvents.practices,
                practicesRequiredPerWeek: cfg?.practicesPerWeek || 0,
                fieldDatesUsed: Array.from(ts.fieldDatesUsed).sort(),
                cageDatesUsed: Array.from(ts.cageDatesUsed).sort(),
                reason: 'No available slots remaining after all draft rounds',
              });
            }
          }
          break;
        }

        round++;
      }

      if (round >= maxRounds) {
        console.log(`  ⚠️  Reached max rounds limit for week ${week.weekNumber + 1}`);
      }
    }

    // Report any teams that didn't get all their practices
    for (const teamState of this.teamSchedulingStates.values()) {
      const config = this.divisionConfigs.get(teamState.divisionId);
      if (!config) continue;

      const totalNeeded = config.practicesPerWeek * practiceWeeks.length;
      if (teamState.practicesScheduled < totalNeeded) {
        // Find the detailed failure summaries from the scheduling log for this team
        // Dedupe by week number to avoid showing the same week multiple times
        const seenWeeks = new Set<number>();
        const failureSummaries = this.schedulingLog
          .filter(entry => {
            if (entry.category !== 'practice' ||
                entry.level !== 'error' ||
                entry.details?.teamId !== teamState.teamId ||
                !entry.summary) {
              return false;
            }
            const weekNum = entry.details?.weekNumber;
            if (weekNum !== undefined && seenWeeks.has(weekNum)) {
              return false;
            }
            if (weekNum !== undefined) {
              seenWeeks.add(weekNum);
            }
            return true;
          })
          .map(entry => entry.summary!)
          .slice(0, 5); // Limit to first 5 to avoid overwhelming summary

        const shortfall = totalNeeded - teamState.practicesScheduled;
        let summary = `${teamState.teamName} (${teamState.divisionName}) is short ${shortfall} practice${shortfall > 1 ? 's' : ''}.`;
        if (failureSummaries.length > 0) {
          summary += '\n\nReasons:\n' + failureSummaries.join('\n\n');
          if (shortfall > failureSummaries.length) {
            summary += `\n\n(${shortfall - failureSummaries.length} more weeks not shown)`;
          }
        }

        this.warnings.push({
          type: 'insufficient_resources',
          message: `Team ${teamState.teamName} (${teamState.divisionName}) only got ${teamState.practicesScheduled}/${totalNeeded} practices`,
          summary,
          details: {
            teamId: teamState.teamId,
            divisionName: teamState.divisionName,
            scheduled: teamState.practicesScheduled,
            needed: totalNeeded,
          },
        });

        // Log at error level for easy filtering - summary of total shortfall
        this.log('error', 'practice', `Practice requirement not met for ${teamState.teamName} (${teamState.divisionName}): ${teamState.practicesScheduled}/${totalNeeded} practices scheduled`, {
          teamId: teamState.teamId,
          teamName: teamState.teamName,
          divisionId: teamState.divisionId,
          divisionName: teamState.divisionName,
          practicesScheduled: teamState.practicesScheduled,
          practicesNeeded: totalNeeded,
          practicesPerWeek: config.practicesPerWeek,
          totalWeeks: practiceWeeks.length,
          shortfall: totalNeeded - teamState.practicesScheduled,
        });
      }
    }

    const totalPractices = this.scheduledEvents.filter((e) => e.eventType === 'practice').length;
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
        console.log(`      ✅ Chose slot: ${rs.slot.date} ${availableTime.startTime}-${availableTime.endTime} at field ${rs.resourceId}`);

        this.scheduledEvents.push({
          seasonId: this.season.id,
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
          // Schedule both events
          this.scheduledEvents.push({
            seasonId: this.season.id,
            divisionId,
            eventType: 'practice',
            date,
            startTime: fieldStart,
            endTime: fieldEnd,
            fieldId: fieldSlot.resourceId,
            teamId,
          });

          this.scheduledEvents.push({
            seasonId: this.season.id,
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
          // Schedule both events (cage first)
          this.scheduledEvents.push({
            seasonId: this.season.id,
            divisionId,
            eventType: 'cage',
            date,
            startTime: cageStartAlt,
            endTime: cageEndAlt,
            cageId: cageSlot.resourceId,
            teamId,
          });

          this.scheduledEvents.push({
            seasonId: this.season.id,
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
   * Schedule cage sessions for all teams using draft-based allocation
   * Round-robin ensures fair distribution of slots across teams
   */
  private async scheduleCageSessions(): Promise<void> {
    console.log('\n--- Scheduling Cage Sessions (Draft-Based) ---');
    console.log(`Total teams: ${this.teams.length}`);
    this.log('info', 'cage', 'Starting draft-based cage session scheduling phase');

    if (!this.scoringContext) {
      throw new Error('Scoring context not initialized');
    }

    // Get the WeekDefinitions that have cage dates (all season dates allow cages)
    const cageWeeks = this.weekDefinitions.filter((week) =>
      week.dates.some((date) => this.isPracticeDateAllowed(date))
    );
    console.log(`Total weeks for cages: ${cageWeeks.length}`);
    this.log('info', 'cage', `Scheduling cage sessions across ${cageWeeks.length} weeks using draft allocation`, {
      firstWeek: cageWeeks[0]?.startDate,
      lastWeek: cageWeeks[cageWeeks.length - 1]?.endDate,
    });

    // Process week by week
    for (const week of cageWeeks) {
      console.log(`\nWeek ${week.weekNumber + 1} (${week.startDate} to ${week.endDate}):`);

      // Get teams that need cage sessions this week, sorted by who is furthest behind their target
      const teamsNeedingCages = Array.from(this.teamSchedulingStates.values())
        .filter((ts) => {
          const config = this.divisionConfigs.get(ts.divisionId);
          if (!config || !config.cageSessionsPerWeek) return false;
          return teamNeedsEventInWeek(ts, 'cage', week.weekNumber, {
            practicesPerWeek: config.practicesPerWeek,
            gamesPerWeek: config.gamesPerWeek || 0,
            cageSessionsPerWeek: config.cageSessionsPerWeek,
          });
        })
        .sort((a, b) => {
          // Sort by who is furthest behind their cage target
          const configA = this.divisionConfigs.get(a.divisionId);
          const configB = this.divisionConfigs.get(b.divisionId);
          const expectedA = week.weekNumber * (configA?.cageSessionsPerWeek || 1);
          const expectedB = week.weekNumber * (configB?.cageSessionsPerWeek || 1);
          const deficitA = expectedA - a.cagesScheduled;
          const deficitB = expectedB - b.cagesScheduled;
          return deficitB - deficitA;
        });

      // Rotate starting position based on week number for additional fairness
      const rotatedByWeek = rotateArray(teamsNeedingCages, week.weekNumber);

      if (rotatedByWeek.length === 0) {
        console.log('  No teams need cage sessions this week');
        continue;
      }

      // Draft rounds - keep going until no team needs more cages this week
      let round = 0;
      const maxRounds = 10; // Safety limit

      while (round < maxRounds) {
        // Check if any team still needs a cage session this week, prioritizing those furthest behind
        const stillNeedCages = rotatedByWeek
          .filter((ts) => {
            const config = this.divisionConfigs.get(ts.divisionId);
            if (!config || !config.cageSessionsPerWeek) return false;
            return teamNeedsEventInWeek(ts, 'cage', week.weekNumber, {
              practicesPerWeek: config.practicesPerWeek,
              gamesPerWeek: config.gamesPerWeek || 0,
              cageSessionsPerWeek: config.cageSessionsPerWeek,
            });
          })
          .sort((a, b) => {
            // Re-sort by current deficit
            const configA = this.divisionConfigs.get(a.divisionId);
            const configB = this.divisionConfigs.get(b.divisionId);
            const expectedA = (week.weekNumber + 1) * (configA?.cageSessionsPerWeek || 1);
            const expectedB = (week.weekNumber + 1) * (configB?.cageSessionsPerWeek || 1);
            const deficitA = expectedA - a.cagesScheduled;
            const deficitB = expectedB - b.cagesScheduled;
            return deficitB - deficitA;
          });

        if (stillNeedCages.length === 0) {
          console.log(`  All teams met cage requirements for this week`);
          break;
        }

        // Rotate team order within round for fairness among teams with similar deficits
        const rotatedTeams = rotateArray(stillNeedCages, round);
        console.log(`  Round ${round + 1}: ${rotatedTeams.length} teams still need cage sessions`);

        let anyScheduledThisRound = false;

        for (const teamState of rotatedTeams) {
          const config = this.divisionConfigs.get(teamState.divisionId);
          if (!config || !config.cageSessionsPerWeek) continue;

          // Check if this team still needs a cage session this week
          if (!teamNeedsEventInWeek(teamState, 'cage', week.weekNumber, {
            practicesPerWeek: config.practicesPerWeek,
            gamesPerWeek: config.gamesPerWeek || 0,
            cageSessionsPerWeek: config.cageSessionsPerWeek,
          })) {
            continue;
          }

          // Filter cage slots to this week and compatible with division
          const weekSlots = this.cageSlots
            .filter((rs) =>
              week.dates.includes(rs.slot.date) &&
              this.isCageCompatibleWithDivision(rs.resourceId, teamState.divisionId)
            )
            .map((rs) => ({
              ...rs,
              resourceType: 'cage' as const,
            }));

          const cageSessionDuration = config.cageSessionDurationHours ?? 1;

          // Generate placement candidates
          const candidates = generateCandidatesForTeamEvent(
            teamState,
            'cage',
            weekSlots,
            week,
            cageSessionDuration,
            this.season.id,
            this.scoringContext
          );

          if (candidates.length === 0) {
            console.log(`    ${teamState.teamName}: No candidates available`);

            // Find what events are already scheduled in this week
            const eventsThisWeek = this.scheduledEvents.filter(e => week.dates.includes(e.date));
            const cageSessionDurationValue = config.cageSessionDurationHours ?? 1;

            // Generate human-readable summary
            const summary = this.generateNoSlotsAvailableSummary(
              teamState,
              'cage',
              week,
              weekSlots,
              cageSessionDurationValue,
              eventsThisWeek
            );

            // Log at error level for easy filtering
            this.log('error', 'cage', `No cage slots available for ${teamState.teamName} (${teamState.divisionName}) in week ${week.weekNumber + 1}`, {
              teamId: teamState.teamId,
              teamName: teamState.teamName,
              divisionName: teamState.divisionName,
              weekNumber: week.weekNumber + 1,
              weekStart: week.startDate,
              weekEnd: week.endDate,
              weekSlotsCount: weekSlots.length,
              requiredDuration: cageSessionDurationValue,
              fieldDatesUsed: Array.from(teamState.fieldDatesUsed).sort(),
              cageDatesUsed: Array.from(teamState.cageDatesUsed).sort(),
              reason: weekSlots.length === 0
                ? 'No compatible cage slots available this week'
                : 'All available slots conflict with existing events or team schedule',
            }, summary);
            continue;
          }

          // Score and select the best candidate
          const bestCandidate = selectBestCandidate(
            candidates,
            teamState,
            this.scoringContext,
            this.scoringWeights
          );

          if (!bestCandidate) {
            console.log(`    ${teamState.teamName}: No valid candidate found`);
            continue;
          }

          // Convert to event draft and add to scheduled events
          const eventDraft = candidateToEventDraft(bestCandidate, teamState.divisionId);
          this.scheduledEvents.push(eventDraft);
          this.scoringContext.scheduledEvents = this.scheduledEvents;

          // Update team state
          updateTeamStateAfterScheduling(teamState, eventDraft, week.weekNumber);

          // Update resource usage in scoring context
          updateResourceUsage(this.scoringContext, bestCandidate.resourceId, bestCandidate.date, cageSessionDuration);

          const dayName = ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek];
          console.log(`    ✅ ${teamState.teamName}: ${bestCandidate.date} (${dayName}) ${bestCandidate.startTime}-${bestCandidate.endTime} @ ${bestCandidate.resourceName} (score: ${bestCandidate.score.toFixed(1)})`);

          this.log('info', 'cage', `Scheduled cage session for ${teamState.teamName}`, {
            teamId: teamState.teamId,
            teamName: teamState.teamName,
            date: bestCandidate.date,
            dayOfWeek: bestCandidate.dayOfWeek,
            dayName,
            time: `${bestCandidate.startTime}-${bestCandidate.endTime}`,
            resourceName: bestCandidate.resourceName,
            score: bestCandidate.score,
            scoreBreakdown: bestCandidate.scoreBreakdown,
          });

          anyScheduledThisRound = true;
        }

        if (!anyScheduledThisRound) {
          console.log(`  No cage sessions scheduled this round, moving to next week`);
          // Log which teams still needed cage sessions but couldn't get any
          const unscheduledTeams = teamsNeedingCages.filter((ts) => {
            const cfg = this.divisionConfigs.get(ts.divisionId);
            if (!cfg || !cfg.cageSessionsPerWeek) return false;
            return teamNeedsEventInWeek(ts, 'cage', week.weekNumber, {
              practicesPerWeek: cfg.practicesPerWeek,
              gamesPerWeek: cfg.gamesPerWeek || 0,
              cageSessionsPerWeek: cfg.cageSessionsPerWeek,
            });
          });
          if (unscheduledTeams.length > 0) {
            for (const ts of unscheduledTeams) {
              const weekEvents = ts.eventsPerWeek.get(week.weekNumber) || { games: 0, practices: 0, cages: 0 };
              const cfg = this.divisionConfigs.get(ts.divisionId);
              this.log('error', 'cage', `Failed to schedule cage session for ${ts.teamName} in week ${week.weekNumber + 1}`, {
                teamId: ts.teamId,
                teamName: ts.teamName,
                weekNumber: week.weekNumber + 1,
                weekStart: week.startDate,
                weekEnd: week.endDate,
                cagesScheduledThisWeek: weekEvents.cages,
                cagesRequiredPerWeek: cfg?.cageSessionsPerWeek || 0,
                fieldDatesUsed: Array.from(ts.fieldDatesUsed).sort(),
                cageDatesUsed: Array.from(ts.cageDatesUsed).sort(),
                reason: 'No available slots remaining after all draft rounds',
              });
            }
          }
          break;
        }

        round++;
      }

      if (round >= maxRounds) {
        console.log(`  ⚠️  Reached max rounds limit for week ${week.weekNumber + 1}`);
      }
    }

    // Report any teams that didn't get all their cage sessions
    for (const teamState of this.teamSchedulingStates.values()) {
      const config = this.divisionConfigs.get(teamState.divisionId);
      if (!config || !config.cageSessionsPerWeek) continue;

      const totalNeeded = config.cageSessionsPerWeek * cageWeeks.length;
      if (teamState.cagesScheduled < totalNeeded) {
        // Find the detailed failure summaries from the scheduling log for this team
        // Dedupe by week number to avoid showing the same week multiple times
        const seenWeeks = new Set<number>();
        const failureSummaries = this.schedulingLog
          .filter(entry => {
            if (entry.category !== 'cage' ||
                entry.level !== 'error' ||
                entry.details?.teamId !== teamState.teamId ||
                !entry.summary) {
              return false;
            }
            const weekNum = entry.details?.weekNumber;
            if (weekNum !== undefined && seenWeeks.has(weekNum)) {
              return false;
            }
            if (weekNum !== undefined) {
              seenWeeks.add(weekNum);
            }
            return true;
          })
          .map(entry => entry.summary!)
          .slice(0, 5); // Limit to first 5 to avoid overwhelming summary

        const shortfall = totalNeeded - teamState.cagesScheduled;
        let summary = `${teamState.teamName} (${teamState.divisionName}) is short ${shortfall} cage session${shortfall > 1 ? 's' : ''}.`;
        if (failureSummaries.length > 0) {
          summary += '\n\nReasons:\n' + failureSummaries.join('\n\n');
          if (shortfall > failureSummaries.length) {
            summary += `\n\n(${shortfall - failureSummaries.length} more weeks not shown)`;
          }
        }

        this.warnings.push({
          type: 'insufficient_resources',
          message: `Team ${teamState.teamName} (${teamState.divisionName}) only got ${teamState.cagesScheduled}/${totalNeeded} cage sessions`,
          summary,
          details: {
            teamId: teamState.teamId,
            divisionName: teamState.divisionName,
            scheduled: teamState.cagesScheduled,
            needed: totalNeeded,
          },
        });

        // Log at error level for easy filtering - summary of total shortfall
        this.log('error', 'cage', `Cage requirement not met for ${teamState.teamName} (${teamState.divisionName}): ${teamState.cagesScheduled}/${totalNeeded} cage sessions scheduled`, {
          teamId: teamState.teamId,
          teamName: teamState.teamName,
          divisionId: teamState.divisionId,
          divisionName: teamState.divisionName,
          cagesScheduled: teamState.cagesScheduled,
          cagesNeeded: totalNeeded,
          cagesPerWeek: config.cageSessionsPerWeek,
          totalWeeks: cageWeeks.length,
          shortfall: totalNeeded - teamState.cagesScheduled,
        });
      }
    }

    const totalCageSessions = this.scheduledEvents.filter((e) => e.eventType === 'cage').length;
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
        console.log(`      ✅ Chose slot: ${rs.slot.date} ${result.time.startTime}-${result.time.endTime} at cage ${rs.resourceId}`);

        this.scheduledEvents.push({
          seasonId: this.season.id,
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
   * Compute the available slots for each team needing events this round.
   * This is used for scarcity-aware scoring - we want to avoid taking slots
   * that are another team's only option.
   */
  private computeTeamSlotAvailability(
    teamsNeedingEvents: TeamSchedulingState[],
    resourceSlots: ResourceSlot[],
    week: WeekDefinition
  ): void {
    const teamSlotAvailability = new Map<string, Set<string>>();

    for (const teamState of teamsNeedingEvents) {
      const availableSlots = new Set<string>();
      const config = this.divisionConfigs.get(teamState.divisionId);
      if (!config) continue;

      // Filter slots to this week and compatible with division
      // For practices (field events), only check fieldDatesUsed since cage + field on same day is OK
      const teamWeekSlots = resourceSlots.filter((rs) =>
        week.dates.includes(rs.slot.date) &&
        this.isFieldCompatibleWithDivision(rs.resourceId, teamState.divisionId) &&
        !teamState.fieldDatesUsed.has(rs.slot.date) // Team can't have two field events on same day
      );

      const durationHours = config.practiceDurationHours;
      const durationMinutes = durationHours * 60;

      // Generate slot keys for all valid time windows
      for (const rs of teamWeekSlots) {
        // Check if duration fits
        if (rs.slot.duration < durationHours) continue;

        const [startH, startM] = rs.slot.startTime.split(':').map(Number);
        const [endH, endM] = rs.slot.endTime.split(':').map(Number);
        const slotStartMinutes = startH * 60 + startM;
        const slotEndMinutes = endH * 60 + endM;

        // Generate keys at 30-minute intervals
        for (
          let candidateStart = slotStartMinutes;
          candidateStart + durationMinutes <= slotEndMinutes;
          candidateStart += 30
        ) {
          const startTime = `${Math.floor(candidateStart / 60).toString().padStart(2, '0')}:${(candidateStart % 60).toString().padStart(2, '0')}`;

          // Check for resource conflicts with already scheduled events
          const candidateEndMinutes = candidateStart + durationMinutes;
          const endTime = `${Math.floor(candidateEndMinutes / 60).toString().padStart(2, '0')}:${(candidateEndMinutes % 60).toString().padStart(2, '0')}`;

          const hasConflict = this.scoringContext?.scheduledEvents.some((event) => {
            if (event.date !== rs.slot.date) return false;
            const eventResourceId = event.fieldId || event.cageId;
            if (eventResourceId !== rs.resourceId) return false;

            // Check time overlap
            const eventStart = timeToMinutes(event.startTime);
            const eventEnd = timeToMinutes(event.endTime);
            return candidateStart < eventEnd && candidateEndMinutes > eventStart;
          }) ?? false;

          if (!hasConflict) {
            const slotKey = generateSlotKey(rs.slot.date, startTime, rs.resourceId);
            availableSlots.add(slotKey);
          }
        }
      }

      teamSlotAvailability.set(teamState.teamId, availableSlots);
    }

    // Update the scoring context with the computed availability
    if (this.scoringContext) {
      this.scoringContext.teamSlotAvailability = teamSlotAvailability;
    }
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
