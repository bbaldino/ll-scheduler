import type {
  GenerateScheduleRequest,
  GenerateScheduleResult,
  ScheduledEventDraft,
  ScheduledEvent,
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
  ScoredCandidate,
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
  addEventToContext,
  type ScoringContext,
} from './scoring.js';
// Verbose logging - set to true to enable detailed console output
const VERBOSE_LOGGING = false;
function verboseLog(...args: unknown[]): void {
  if (VERBOSE_LOGGING) {
    verboseLog(...args);
  }
}

import {
  rotateArray,
  shuffleWithSeed,
  generateWeekDefinitions,
  initializeTeamState,
  updateTeamStateAfterScheduling,
  generateCandidatesForTeamEvent,
  generateCandidatesForGame,
  selectBestCandidate,
  selectBestCandidateTwoPhase,
  candidateToEventDraft,
  getWeekNumberForDate,
  teamNeedsEventInWeek,
  anyTeamNeedsEventInWeek,
  parseLocalDate,
  formatDateStr,
  generateRoundRobinMatchups,
  assignMatchupsToWeeks,
} from './draft.js';

/**
 * Main schedule generator
 * Generates optimal schedules for games, practices, and cage sessions
 * Uses season.gamesStartDate to determine when games can be scheduled
 * Practices and cages can be scheduled from season.startDate to season.endDate
 */
export class ScheduleGenerator {
  private season: Season;
  private divisions: Division[]; // Ordered by schedulingOrder
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
    this.divisions = divisions; // Already sorted by schedulingOrder from listDivisions
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
   * Initialize the generator with existing events from the database.
   * This allows the generator to work around pre-scheduled events.
   * Must be called AFTER generate() has been called (which initializes team states).
   * Actually, we need to call this BEFORE generate(), so we'll store the events
   * and process them during initializeDraftScheduling.
   */
  private existingEventsToProcess: ScheduledEvent[] = [];
  private existingEventsCount: number = 0; // Track how many existing events were added to scheduledEvents

  public initializeWithExistingEvents(existingEvents: ScheduledEvent[]): void {
    this.existingEventsToProcess = existingEvents;
  }

  /**
   * Process existing events after team states have been initialized.
   * Converts ScheduledEvent to ScheduledEventDraft and updates team states.
   */
  private processExistingEvents(): void {
    if (this.existingEventsToProcess.length === 0) return;

    this.log('info', 'general', `Processing ${this.existingEventsToProcess.length} existing events`);

    for (const event of this.existingEventsToProcess) {
      // Convert ScheduledEvent to ScheduledEventDraft
      const draft: ScheduledEventDraft = {
        seasonId: event.seasonId,
        divisionId: event.divisionId,
        eventType: event.eventType,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        fieldId: event.fieldId,
        cageId: event.cageId,
        homeTeamId: event.homeTeamId,
        awayTeamId: event.awayTeamId,
        teamId: event.teamId,
      };

      // Add to scheduled events
      this.scheduledEvents.push(draft);

      // Add to scoring context for conflict detection
      if (this.scoringContext) {
        addEventToContext(this.scoringContext, draft);
      }

      // Determine which week this event falls in
      const weekNumber = this.getWeekNumberForDate(event.date);

      // Update team scheduling states
      if (event.eventType === 'game' && event.homeTeamId && event.awayTeamId) {
        const homeState = this.teamSchedulingStates.get(event.homeTeamId);
        const awayState = this.teamSchedulingStates.get(event.awayTeamId);

        if (homeState) {
          updateTeamStateAfterScheduling(homeState, draft, weekNumber, true, event.awayTeamId);
        }
        if (awayState) {
          updateTeamStateAfterScheduling(awayState, draft, weekNumber, false, event.homeTeamId);
        }
      } else if (event.teamId) {
        const teamState = this.teamSchedulingStates.get(event.teamId);
        if (teamState) {
          updateTeamStateAfterScheduling(teamState, draft, weekNumber);
        }
      }
    }

    // Track how many existing events were added (so we can exclude them from getScheduledEvents)
    this.existingEventsCount = this.existingEventsToProcess.length;

    this.log('info', 'general', `Initialized with existing: ${this.scheduledEvents.filter(e => e.eventType === 'game').length} games, ${this.scheduledEvents.filter(e => e.eventType === 'practice').length} practices, ${this.scheduledEvents.filter(e => e.eventType === 'cage').length} cage sessions`);
  }

  /**
   * Get the week number (1-based) for a given date
   */
  private getWeekNumberForDate(dateStr: string): number {
    for (const week of this.weekDefinitions) {
      if (week.dates.includes(dateStr)) {
        return week.weekNumber;
      }
    }
    return 1; // Default to week 1 if not found
  }

  /**
   * Get the effective games start date for the season
   * Falls back to season start date if gamesStartDate is not set
   */
  private getGamesStartDate(): string {
    return this.season.gamesStartDate || this.season.startDate;
  }

  /**
   * Get games per week for a specific division and week
   * Returns the override value if one exists, otherwise the default gamesPerWeek
   * Week numbers are 1-based (matching the UI)
   */
  private getGamesPerWeekForDivision(divisionId: string, weekNumber: number): number {
    const config = this.divisionConfigs.get(divisionId);
    if (!config) return 0;

    const override = config.gameWeekOverrides?.find(o => o.weekNumber === weekNumber);
    if (override !== undefined) {
      return override.gamesPerWeek;
    }
    return config.gamesPerWeek;
  }

  /**
   * Calculate total games per team for a division across all game weeks
   * Accounts for per-week overrides and maxGamesPerSeason cap
   */
  private getTotalGamesPerTeam(divisionId: string, gameWeeks: WeekDefinition[]): number {
    let total = 0;
    for (let i = 0; i < gameWeeks.length; i++) {
      // Use 1-based game week index for override lookup
      total += this.getGamesPerWeekForDivision(divisionId, i + 1);
    }
    // Cap at maxGamesPerSeason if set
    const config = this.divisionConfigs.get(divisionId);
    if (config?.maxGamesPerSeason && total > config.maxGamesPerSeason) {
      return config.maxGamesPerSeason;
    }
    return total;
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
    // Also verboseLog for server-side debugging
    const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
    verboseLog(`[${level.toUpperCase()}] [${category}] ${message}${detailsStr}`);
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
      verboseLog('='.repeat(80));
      verboseLog('SCHEDULE GENERATION STARTED');
      verboseLog(`Season: ${this.season.name}`);
      verboseLog(`  Full season: ${this.season.startDate} to ${this.season.endDate}`);
      verboseLog(`  Games period: ${this.getGamesStartDate()} to ${this.season.endDate}`);
      verboseLog(`Teams: ${this.teams.length}, Season Fields: ${this.seasonFields.length}, Season Cages: ${this.seasonCages.length}`);
      verboseLog('Division Configs:', Array.from(this.divisionConfigs.entries()).map(([id, config]) => ({
        divisionId: id,
        gamesPerWeek: config.gamesPerWeek,
        practicesPerWeek: config.practicesPerWeek,
        cageSessionsPerWeek: config.cageSessionsPerWeek,
      })));
      verboseLog('='.repeat(80));

      // Step 1: Validate prerequisites
      if (!this.validatePrerequisites()) {
        verboseLog('❌ Validation failed');
        return this.buildResult(false);
      }
      verboseLog('✓ Prerequisites validated');

      // Step 2: Build available resource slots
      this.buildResourceSlots();
      const totalSlots = this.gameFieldSlots.length + this.practiceFieldSlots.length + this.cageSlots.length;
      verboseLog(`✓ Built ${totalSlots} resource slots`);
      verboseLog('Resource slot summary:', {
        gameFields: this.gameFieldSlots.length,
        practiceFields: this.practiceFieldSlots.length,
        cages: this.cageSlots.length,
      });

      // Step 3: Build team constraints
      this.buildTeamConstraints();
      verboseLog(`✓ Built constraints for ${this.teamConstraints.size} teams`);

      // Step 3.5: Initialize draft-based scheduling
      this.initializeDraftScheduling();
      verboseLog(`✓ Initialized draft scheduling with ${this.weekDefinitions.length} weeks`);

      // Step 3.6: Process any existing events that were passed in
      this.processExistingEvents();
      if (this.existingEventsToProcess.length > 0) {
        verboseLog(`✓ Processed ${this.existingEventsToProcess.length} existing events`);
      }

      // Step 4: Schedule games
      verboseLog('\n' + '-'.repeat(80));
      verboseLog('SCHEDULING GAMES');
      verboseLog('-'.repeat(80));
      let stepStart = Date.now();
      await this.scheduleGames();
      console.log(`  scheduleGames: ${Date.now() - stepStart}ms`);
      verboseLog(`✓ Games scheduled: ${this.scheduledEvents.filter(e => e.eventType === 'game').length}`);

      // Step 5: Schedule practices
      verboseLog('\n' + '-'.repeat(80));
      verboseLog('SCHEDULING PRACTICES');
      verboseLog('-'.repeat(80));
      stepStart = Date.now();
      await this.schedulePractices();
      console.log(`  schedulePractices: ${Date.now() - stepStart}ms`);
      verboseLog(`✓ Practices scheduled: ${this.scheduledEvents.filter(e => e.eventType === 'practice').length}`);

      // Step 6: Schedule cage sessions
      verboseLog('\n' + '-'.repeat(80));
      verboseLog('SCHEDULING CAGE SESSIONS');
      verboseLog('-'.repeat(80));
      stepStart = Date.now();
      await this.scheduleCageSessions();
      console.log(`  scheduleCageSessions: ${Date.now() - stepStart}ms`);
      verboseLog(`✓ Cage sessions scheduled: ${this.scheduledEvents.filter(e => e.eventType === 'cage').length}`);

      verboseLog('\n' + '='.repeat(80));
      verboseLog('SCHEDULE GENERATION COMPLETED');
      verboseLog(`Total events: ${this.scheduledEvents.length}`);
      verboseLog(`Errors: ${this.errors.length}, Warnings: ${this.warnings.length}`);
      verboseLog('='.repeat(80));

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

    const allDatesRaw = getDateRange(this.season.startDate, this.season.endDate);

    // Filter out season-level blackout dates
    const blackoutSet = new Set(this.season.blackoutDates || []);
    const allDates = allDatesRaw.filter(date => !blackoutSet.has(date));

    if (blackoutSet.size > 0) {
      this.log('info', 'general', `Excluding ${blackoutSet.size} blackout dates from scheduling`, {
        blackoutDates: Array.from(blackoutSet).sort(),
      });
    }

    // Build game field slots for dates from gamesStartDate onwards
    // Exclude practice-only fields for games
    const gameDates = allDates.filter(date => this.isGameDateAllowed(date));
    this.buildFieldSlotsForDates(gameDates, this.gameFieldSlots, true);

    // Build practice field slots for all season dates
    // Include all fields (both game-capable and practice-only)
    const practiceDates = allDates.filter(date => this.isPracticeDateAllowed(date));
    this.buildFieldSlotsForDates(practiceDates, this.practiceFieldSlots, false);

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
   * @param excludePracticeOnly - if true, skip fields marked as practice-only (for game slots)
   */
  private buildFieldSlotsForDates(dates: string[], targetSlots: ResourceSlot[], excludePracticeOnly: boolean): void {
    for (const date of dates) {
      const dayOfWeek = getDayOfWeek(date);

      for (const seasonField of this.seasonFields) {
        // Skip practice-only fields when building game slots
        if (excludePracticeOnly && seasonField.field?.practiceOnly) {
          continue;
        }

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
   * Schedule games using round-robin matchup generation.
   * Phase 1: Generate all matchups upfront using round-robin algorithm
   * Phase 2: Assign matchups to time slots, optimizing for even spacing between rematches
   */
  private async scheduleGames(): Promise<void> {
    verboseLog('\n--- Scheduling Games (Round-Robin) ---');
    this.log('info', 'game', 'Starting round-robin game scheduling phase');

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

    verboseLog(`Total divisions: ${teamsByDivision.size}`);
    this.log('info', 'game', `Found ${teamsByDivision.size} divisions with teams to schedule games for`);

    // Get weeks where games are allowed (any date >= gamesStartDate)
    const gameWeeks = this.weekDefinitions.filter((week) =>
      week.dates.some((date) => this.isGameDateAllowed(date))
    );
    verboseLog(`Total weeks for games: ${gameWeeks.length}`);

    // Build division info and generate matchups for each division
    type DivisionMatchups = {
      divisionId: string;
      divisionName: string;
      teams: Team[];
      config: { gamesPerWeek: number; gameDurationHours: number };
      matchups: Array<GameMatchup & { targetWeek: number }>;
    };

    const divisionMatchupsList: DivisionMatchups[] = [];

    // Iterate over divisions in schedulingOrder (this.divisions is already sorted)
    for (const division of this.divisions) {
      const divisionId = division.id;
      const divisionTeams = teamsByDivision.get(divisionId);
      if (!divisionTeams || divisionTeams.length === 0) {
        continue; // No teams in this division for this season
      }
      const config = this.divisionConfigs.get(divisionId);
      const divisionName = division.name;
      verboseLog(`\nDivision: ${divisionName}`);
      verboseLog(`  Teams: ${divisionTeams.length}`);
      verboseLog(`  Has config: ${!!config}`);
      verboseLog(`  Games per week: ${config?.gamesPerWeek || 'N/A'}`);

      if (!config || !config.gamesPerWeek) {
        verboseLog(`  ⏭️  Skipping (no games scheduled for this division)`);
        continue;
      }

      // Calculate games per week for each week (may vary due to overrides)
      // Note: gameWeekIndex is 0-based, overrides use 1-based week numbers relative to game weeks
      const gamesPerWeekByWeek: number[] = gameWeeks.map((_, gameWeekIndex) =>
        this.getGamesPerWeekForDivision(divisionId, gameWeekIndex + 1)
      );

      // Calculate exact number of games needed (sum of per-week values)
      let totalGamesPerTeam = gamesPerWeekByWeek.reduce((sum, g) => sum + g, 0);

      // Cap at maxGamesPerSeason if set
      if (config.maxGamesPerSeason && totalGamesPerTeam > config.maxGamesPerSeason) {
        verboseLog(`  Capping games from ${totalGamesPerTeam} to maxGamesPerSeason: ${config.maxGamesPerSeason}`);
        totalGamesPerTeam = config.maxGamesPerSeason;
      }

      const numTeams = divisionTeams.length;
      const numOpponents = numTeams - 1;

      // Total matchups needed = (gamesPerTeam * numTeams) / 2 (each game involves 2 teams)
      const totalMatchupsNeeded = (totalGamesPerTeam * numTeams) / 2;

      // Calculate round-robin cycles needed (may generate slightly more than needed)
      const minCycles = Math.ceil(totalGamesPerTeam / numOpponents);

      // Log per-week game distribution if there are overrides
      const hasOverrides = config.gameWeekOverrides && config.gameWeekOverrides.length > 0 || !!config.maxGamesPerSeason;
      verboseLog(`  Total games per team needed: ${totalGamesPerTeam}${hasOverrides ? ' (with overrides)' : ''}`);
      if (hasOverrides) {
        verboseLog(`  Per-week games: ${gamesPerWeekByWeek.map((g, i) => `W${i+1}:${g}`).join(', ')}`);
      }
      verboseLog(`  Total matchups needed: ${totalMatchupsNeeded}`);
      verboseLog(`  Opponents: ${numOpponents}`);
      verboseLog(`  Round-robin cycles to generate: ${minCycles}`);

      // Phase 1: Generate round-robin matchups
      const teamIds = divisionTeams.map(t => t.id);
      const rounds = generateRoundRobinMatchups(teamIds, minCycles);

      // Each round-robin round has every team playing exactly once.
      // With per-week overrides, we need variable rounds per week.
      const matchupsPerRound = numTeams / 2; // For even teams
      const totalRoundsNeeded = totalGamesPerTeam; // Total rounds = total games per team

      verboseLog(`  Rounds generated: ${rounds.length}`);
      verboseLog(`  Matchups per round: ${matchupsPerRound}`);
      verboseLog(`  Total rounds needed: ${totalRoundsNeeded}`);

      // Take only the rounds we need
      // Note: This may cause home/away imbalance if we're not using complete cycles
      const roundsToUse = rounds.slice(0, totalRoundsNeeded);

      // Check if we're cutting mid-cycle (which could cause imbalance)
      const roundsPerCycle = numTeams - 1; // For even teams
      const completeCycles = Math.floor(roundsToUse.length / roundsPerCycle);
      const extraRounds = roundsToUse.length % roundsPerCycle;
      if (extraRounds > 0) {
        verboseLog(`  ⚠️ Using ${completeCycles} complete cycles + ${extraRounds} extra rounds (may cause home/away imbalance)`);
      }

      if (roundsToUse.length < totalRoundsNeeded) {
        console.warn(`  ⚠️ Not enough rounds: have ${roundsToUse.length}, need ${totalRoundsNeeded}`);
        this.log('warning', 'game', `Not enough round-robin rounds for ${divisionName}`, {
          divisionId,
          roundsGenerated: rounds.length,
          roundsNeeded: totalRoundsNeeded,
          gamesPerWeek: config.gamesPerWeek,
          weeks: gameWeeks.length,
        });
      }

      // Assign rounds to weeks, respecting per-week game counts
      const matchups: Array<GameMatchup & { targetWeek: number }> = [];
      let roundIndex = 0;
      for (let weekIdx = 0; weekIdx < gameWeeks.length; weekIdx++) {
        const gamesThisWeek = gamesPerWeekByWeek[weekIdx];
        // Assign gamesThisWeek rounds to this week
        for (let r = 0; r < gamesThisWeek && roundIndex < roundsToUse.length; r++) {
          const round = roundsToUse[roundIndex++];
          for (const m of round.matchups) {
            matchups.push({
              homeTeamId: m.homeTeamId,
              awayTeamId: m.awayTeamId,
              divisionId,
              targetWeek: weekIdx,
            });
          }
        }
      }

      verboseLog(`  Total matchups assigned: ${matchups.length}`);

      // Rebalance home/away if needed (when we use partial cycles)
      this.rebalanceHomeAway(matchups, divisionTeams);

      // Log the distribution
      const weekCounts = new Map<number, number>();
      for (const m of matchups) {
        weekCounts.set(m.targetWeek, (weekCounts.get(m.targetWeek) || 0) + 1);
      }
      verboseLog(`  Matchups per week:`);
      for (let w = 0; w < gameWeeks.length; w++) {
        const count = weekCounts.get(w) || 0;
        const expectedGames = gamesPerWeekByWeek[w];
        const expectedMatchups = matchupsPerRound * expectedGames;
        const status = count === expectedMatchups ? '✓' : '⚠';
        verboseLog(`    Week ${w + 1}: ${count} matchups (expect ${expectedMatchups}) ${status}`);
      }

      // Build target week distribution with dates (reuse weekCounts from above)
      const weekDistribution: Array<{ week: number; dates: string; targetMatchups: number }> = [];
      for (let w = 0; w < gameWeeks.length; w++) {
        weekDistribution.push({
          week: w,
          dates: `${gameWeeks[w].startDate} to ${gameWeeks[w].endDate}`,
          targetMatchups: weekCounts.get(w) || 0,
        });
      }

      // Build a human-readable summary
      let distributionSummary = `Generated ${matchups.length} matchups for ${divisionName} (need ${totalMatchupsNeeded}).\n`;
      distributionSummary += `\nTarget week distribution:`;
      for (const wd of weekDistribution) {
        distributionSummary += `\n  ${wd.dates}: ${wd.targetMatchups} matchups`;
      }

      // Log home/away balance after matchup generation (before scheduling)
      const preScheduleHomeAway: Record<string, { home: number; away: number; total: number }> = {};
      for (const team of divisionTeams) {
        const home = matchups.filter(m => m.homeTeamId === team.id).length;
        const away = matchups.filter(m => m.awayTeamId === team.id).length;
        preScheduleHomeAway[team.name] = { home, away, total: home + away };
      }

      let homeAwayBalanceSummary = `\nHome/Away balance after matchup generation:`;
      for (const [name, counts] of Object.entries(preScheduleHomeAway)) {
        const diff = Math.abs(counts.home - counts.away);
        const status = diff <= 1 ? '✓' : '⚠';
        homeAwayBalanceSummary += `\n  ${name}: ${counts.home} home, ${counts.away} away (${counts.total} total) ${status}`;
      }
      distributionSummary += homeAwayBalanceSummary;

      this.log('info', 'game', `Generated round-robin matchups for ${divisionName}`, {
        divisionId,
        divisionName,
        teamCount: divisionTeams.length,
        roundRobinCycles: minCycles,
        totalRounds: rounds.length,
        roundsUsed: roundsToUse.length,
        totalMatchups: matchups.length,
        totalMatchupsNeeded,
        weekDistribution,
        preScheduleHomeAway,
      }, distributionSummary);

      divisionMatchupsList.push({
        divisionId,
        divisionName,
        teams: divisionTeams,
        config: { gamesPerWeek: config.gamesPerWeek, gameDurationHours: config.gameDurationHours },
        matchups,
      });
    }

    // Phase 2: Schedule each matchup to a time slot
    // Process matchups in order (by target week), finding the best available slot
    // Prioritize keeping rematches spread out by preferring slots in the target week

    let totalScheduled = 0;
    let failedToSchedule = 0;

    for (const division of divisionMatchupsList) {
      verboseLog(`\nScheduling ${division.divisionName}:`);

      // Build team lookup map for O(1) access
      const teamLookup = new Map(division.teams.map(t => [t.id, t]));

      // Track preferred day games per team (e.g., Saturday games)
      // Used to balance preferred day distribution
      const preferredDayGames = new Map<string, number>();
      for (const team of division.teams) {
        preferredDayGames.set(team.id, 0);
      }

      // Pre-filter field slots by week for this division (avoid filtering per matchup)
      const fieldSlotsByWeek = new Map<number, ResourceSlot[]>();
      for (let i = 0; i < gameWeeks.length; i++) {
        const week = gameWeeks[i];
        const weekDatesSet = new Set(week.dates);
        const weekSlots = this.gameFieldSlots.filter((rs) =>
          weekDatesSet.has(rs.slot.date) &&
          this.isFieldCompatibleWithDivision(rs.resourceId, division.divisionId)
        );
        fieldSlotsByWeek.set(i, weekSlots);
      }

      // Get the required/preferred days for this division
      const gameDayPrefs = this.scoringContext?.gameDayPreferences.get(division.divisionId) || [];
      const requiredDays = gameDayPrefs.filter(p => p.priority === 'required').map(p => p.dayOfWeek);

      // Calculate fair share of preferred-day games based on actual slot availability
      // Count how many preferred-day game slots are available for this division
      let totalPreferredDaySlots = 0;
      if (requiredDays.length > 0) {
        for (const slot of this.gameFieldSlots) {
          if (requiredDays.includes(slot.slot.dayOfWeek) &&
              this.isFieldCompatibleWithDivision(slot.resourceId, division.divisionId)) {
            // Count each slot as one game opportunity
            // (the slot duration check happens during candidate generation)
            totalPreferredDaySlots++;
          }
        }
        // Each game involves 2 teams, so total team-game-opportunities = slots * 2
        // Fair share per team = floor(slots * 2 / numTeams) - use floor to be conservative
        const numTeams = division.teams.length;
        const fairSharePerTeam = Math.floor((totalPreferredDaySlots * 2) / numTeams);
        verboseLog(`  Preferred-day slots: ${totalPreferredDaySlots}, fair share per team: ${fairSharePerTeam}`);

        // Store for use in scheduling loop
        (division as any).fairSharePerTeam = fairSharePerTeam;
      } else {
        (division as any).fairSharePerTeam = Infinity; // No limit if no required days
      }

      // Group matchups by target week, then sort within each week
      // to prioritize teams with fewer preferred-day games
      const matchupsByWeek = new Map<number, Array<GameMatchup & { targetWeek: number }>>();
      for (const matchup of division.matchups) {
        if (!matchupsByWeek.has(matchup.targetWeek)) {
          matchupsByWeek.set(matchup.targetWeek, []);
        }
        matchupsByWeek.get(matchup.targetWeek)!.push(matchup);
      }

      // Process weeks in order
      const weekNumbers = Array.from(matchupsByWeek.keys()).sort((a, b) => a - b);

      for (const weekNum of weekNumbers) {
        const weekMatchups = matchupsByWeek.get(weekNum)!;
        const weekFieldSlots = fieldSlotsByWeek.get(weekNum) || [];

        // Count how many games can fit on required days this week
        // A single slot (e.g., 9am-6pm) can hold multiple games
        let requiredDayGameCapacity = 0;
        if (requiredDays.length > 0) {
          for (const slot of weekFieldSlots) {
            if (requiredDays.includes(slot.slot.dayOfWeek)) {
              // Calculate how many games of this division's duration can fit in this slot
              const gamesInSlot = Math.floor(slot.slot.duration / division.config.gameDurationHours);
              requiredDayGameCapacity += gamesInSlot;
            }
          }
        }

        // Determine if there's scarcity: fewer required-day game slots than matchups
        const hasRequiredDayScarcity = requiredDays.length > 0 && requiredDayGameCapacity < weekMatchups.length;
        if (hasRequiredDayScarcity) {
          verboseLog(`  Week ${weekNum + 1}: Required-day scarcity - ${requiredDayGameCapacity} game slots for ${weekMatchups.length} matchups`);
        }

        // Sort matchups to balance fairness:
        // 1. Teams with more short rest games go first (so they get first pick of non-short-rest slots)
        // 2. Teams with fewer preferred-day games go first (matters when there's scarcity)
        const sortedMatchups = [...weekMatchups].sort((a, b) => {
          // First priority: teams with more short rest games should go first
          const aMaxShortRest = Math.max(
            this.teamSchedulingStates.get(a.homeTeamId)?.shortRestGamesCount || 0,
            this.teamSchedulingStates.get(a.awayTeamId)?.shortRestGamesCount || 0
          );
          const bMaxShortRest = Math.max(
            this.teamSchedulingStates.get(b.homeTeamId)?.shortRestGamesCount || 0,
            this.teamSchedulingStates.get(b.awayTeamId)?.shortRestGamesCount || 0
          );
          if (aMaxShortRest !== bMaxShortRest) {
            return bMaxShortRest - aMaxShortRest; // Higher short rest count goes first
          }

          // Second priority: teams with fewer preferred-day games go first
          const aMinGames = Math.min(
            preferredDayGames.get(a.homeTeamId) || 0,
            preferredDayGames.get(a.awayTeamId) || 0
          );
          const bMinGames = Math.min(
            preferredDayGames.get(b.homeTeamId) || 0,
            preferredDayGames.get(b.awayTeamId) || 0
          );
          return aMinGames - bMinGames;
        });

        // Track how many required-day slots we've used this week
        let requiredDaySlotsUsedThisWeek = 0;

        // Process each matchup in sorted order
        for (const matchup of sortedMatchups) {
        const homeTeam = teamLookup.get(matchup.homeTeamId);
        const awayTeam = teamLookup.get(matchup.awayTeamId);
        const homeTeamState = this.teamSchedulingStates.get(matchup.homeTeamId);
        const awayTeamState = this.teamSchedulingStates.get(matchup.awayTeamId);

        if (!homeTeam || !awayTeam || !homeTeamState || !awayTeamState) {
          verboseLog(`  ⚠️  Missing team data for matchup`);
          failedToSchedule++;
          continue;
        }

        // Only try the assigned target week - don't move matchups between weeks
        // The assignMatchupsToWeeks algorithm already ensured 2-regularity,
        // so if we can't schedule here, there's a field capacity issue
        let scheduled = false;
        let failureReason = '';
        const week = gameWeeks[matchup.targetWeek];

        if (!week) {
          failureReason = 'target_week_not_found';
        } else {
          // Check if either team has already met their games-per-week quota
          // (This shouldn't happen if assignMatchupsToWeeks worked correctly)
          const homeGamesThisWeek = homeTeamState.eventsPerWeek.get(week.weekNumber)?.games || 0;
          const awayGamesThisWeek = awayTeamState.eventsPerWeek.get(week.weekNumber)?.games || 0;
          // matchup.targetWeek is the game week index (0-based), use +1 for override lookup
          const gamesPerWeekQuota = this.getGamesPerWeekForDivision(division.divisionId, matchup.targetWeek + 1);
          if (homeGamesThisWeek >= gamesPerWeekQuota) {
            failureReason = `${homeTeam.name} already at quota (${homeGamesThisWeek}/${gamesPerWeekQuota})`;
          } else if (awayGamesThisWeek >= gamesPerWeekQuota) {
            failureReason = `${awayTeam.name} already at quota (${awayGamesThisWeek}/${gamesPerWeekQuota})`;
          } else {
            // Use pre-filtered field slots for this week
            const weekFieldSlots = fieldSlotsByWeek.get(matchup.targetWeek) || [];

            if (weekFieldSlots.length === 0) {
              failureReason = 'no_compatible_field_slots';
            } else {
              // Generate placement candidates for this game
              const candidates = generateCandidatesForGame(
                matchup,
                weekFieldSlots,
                week,
                division.config.gameDurationHours,
                this.season.id,
                this.scoringContext!
              );

              if (candidates.length === 0) {
                failureReason = 'no_valid_time_slots (all slots have conflicts)';
              } else {
                // Use all candidates - let the two-phase approach handle required day priority
                // We want to fill all required-day slots first before using non-required days
                const filteredCandidates = candidates;

                // Two-phase approach: try required days first, fall back to other days only if needed
                let bestCandidate: ScoredCandidate | undefined;
                let usedFallback = false;

                if (requiredDays.length > 0) {
                  // Phase 1: Try required days only
                  const requiredDayCandidates = filteredCandidates.filter(c => requiredDays.includes(c.dayOfWeek));

                  if (requiredDayCandidates.length > 0) {
                    const scoredRequired = requiredDayCandidates.map((c) =>
                      calculatePlacementScore(c, homeTeamState, this.scoringContext!, this.scoringWeights)
                    );
                    scoredRequired.sort((a, b) => b.score - a.score);
                    const bestRequired = scoredRequired[0];

                    // Use required day if it doesn't have a hard constraint violation (sameDayEvent)
                    if (bestRequired && bestRequired.score > -500000) {
                      bestCandidate = bestRequired;
                    } else {
                      // Required day has hard constraint - need to fall back
                      usedFallback = true;

                      // Determine why required day was rejected for logging
                      const breakdown = bestRequired?.scoreBreakdown;
                      let reason = 'unknown';
                      if (breakdown?.sameDayEvent && breakdown.sameDayEvent < -100000) {
                        const homeHasGame = homeTeamState.fieldDatesUsed.has(bestRequired.date);
                        const awayHasGame = awayTeamState.fieldDatesUsed.has(bestRequired.date);
                        if (homeHasGame && awayHasGame) {
                          reason = `Both ${homeTeam.name} and ${awayTeam.name} already have games on ${bestRequired.date}`;
                        } else if (homeHasGame) {
                          reason = `${homeTeam.name} already has a game on ${bestRequired.date}`;
                        } else if (awayHasGame) {
                          reason = `${awayTeam.name} already has a game on ${bestRequired.date}`;
                        }
                      }

                      // Phase 2: Fall back to non-required days
                      const nonRequiredCandidates = filteredCandidates.filter(c => !requiredDays.includes(c.dayOfWeek));
                      if (nonRequiredCandidates.length > 0) {
                        const scoredNonRequired = nonRequiredCandidates.map((c) =>
                          calculatePlacementScore(c, homeTeamState, this.scoringContext!, this.scoringWeights)
                        );
                        scoredNonRequired.sort((a, b) => b.score - a.score);
                        bestCandidate = scoredNonRequired[0];

                        if (bestCandidate) {
                          this.log('warning', 'game', `Non-required day selected for ${homeTeam.name} vs ${awayTeam.name}`, {
                            selectedDate: bestCandidate.date,
                            selectedDay: ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek],
                            selectedScore: bestCandidate.score,
                            bestRequiredDate: bestRequired?.date,
                            bestRequiredDay: bestRequired ? ScheduleGenerator.DAY_NAMES[bestRequired.dayOfWeek] : undefined,
                            bestRequiredScore: bestRequired?.score,
                            reason,
                            requiredDayBreakdown: breakdown ? {
                              gameDayPreference: breakdown.gameDayPreference,
                              sameDayEvent: breakdown.sameDayEvent,
                              dayGap: breakdown.dayGap,
                              timeAdjacency: breakdown.timeAdjacency,
                            } : undefined,
                          }, `Game scheduled on ${ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek]} instead of required day. Reason: ${reason}`);
                        }
                      }
                    }
                  } else {
                    // No required day candidates available (shouldn't happen normally)
                    usedFallback = true;
                    const scoredCandidates = filteredCandidates.map((c) =>
                      calculatePlacementScore(c, homeTeamState, this.scoringContext!, this.scoringWeights)
                    );
                    scoredCandidates.sort((a, b) => b.score - a.score);
                    bestCandidate = scoredCandidates[0];
                  }
                } else {
                  // No required days configured - score all candidates normally
                  const scoredCandidates = filteredCandidates.map((c) =>
                    calculatePlacementScore(c, homeTeamState, this.scoringContext!, this.scoringWeights)
                  );
                  scoredCandidates.sort((a, b) => b.score - a.score);
                  bestCandidate = scoredCandidates[0];
                }

                if (!bestCandidate) {
                  failureReason = 'no_scored_candidate';
                } else if (bestCandidate.score < -500000) {
                  failureReason = 'best_candidate_has_severe_penalty (same day event)';
                } else {
                  // Create the event draft
                  const eventDraft = candidateToEventDraft(bestCandidate, division.divisionId);
                  this.scheduledEvents.push(eventDraft);
                  addEventToContext(this.scoringContext!, eventDraft);

                  // Update both team states
                  updateTeamStateAfterScheduling(homeTeamState, eventDraft, week.weekNumber, true, awayTeamState.teamId);
                  updateTeamStateAfterScheduling(awayTeamState, eventDraft, week.weekNumber, false, homeTeamState.teamId);

                  // Update resource usage
                  updateResourceUsage(this.scoringContext!, bestCandidate.resourceId, bestCandidate.date, division.config.gameDurationHours);

                  const dayName = ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek];

                  verboseLog(`  ✅ ${homeTeam.name} vs ${awayTeam.name}: Week ${week.weekNumber + 1} ${bestCandidate.date} (${dayName}) ${bestCandidate.startTime}-${bestCandidate.endTime} @ ${bestCandidate.resourceName}`);

                  this.log('info', 'game', `Scheduled game: ${homeTeam.name} vs ${awayTeam.name}`, {
                    homeTeamId: bestCandidate.homeTeamId,
                    awayTeamId: bestCandidate.awayTeamId,
                    date: bestCandidate.date,
                    targetWeek: matchup.targetWeek,
                    actualWeek: week.weekNumber,
                    dayOfWeek: bestCandidate.dayOfWeek,
                    dayName,
                    time: `${bestCandidate.startTime}-${bestCandidate.endTime}`,
                    resourceName: bestCandidate.resourceName,
                    score: bestCandidate.score,
                    scoreBreakdown: bestCandidate.scoreBreakdown,
                  });

                  // Track if this was on a preferred day for fair distribution
                  if (requiredDays.includes(bestCandidate.dayOfWeek)) {
                    preferredDayGames.set(matchup.homeTeamId, (preferredDayGames.get(matchup.homeTeamId) || 0) + 1);
                    preferredDayGames.set(matchup.awayTeamId, (preferredDayGames.get(matchup.awayTeamId) || 0) + 1);
                    requiredDaySlotsUsedThisWeek++;
                  }

                  totalScheduled++;
                  scheduled = true;
                }
              }
            }
          }
        }

        if (!scheduled) {
          const weekDates = week ? `${week.startDate} to ${week.endDate}` : 'unknown';

          verboseLog(`  ❌ Could not schedule: ${homeTeam.name} vs ${awayTeam.name} (week ${matchup.targetWeek + 1}): ${failureReason}`);

          const failureSummary = `Could not schedule ${homeTeam.name} vs ${awayTeam.name} in week ${matchup.targetWeek + 1} (${weekDates}).\nReason: ${failureReason}`;

          this.log('warning', 'game', `Failed to schedule matchup: ${homeTeam.name} vs ${awayTeam.name}`, {
            homeTeamId: matchup.homeTeamId,
            awayTeamId: matchup.awayTeamId,
            divisionId: division.divisionId,
            targetWeek: matchup.targetWeek,
            weekDates,
            reason: failureReason,
          }, failureSummary);
          failedToSchedule++;
        }
        } // end for loop for matchups
      } // end weekNumbers loop
    } // end division loop

    // Report summary
    const totalGames = this.scheduledEvents.filter((e) => e.eventType === 'game').length;
    verboseLog(`\n✅ Game scheduling complete. Scheduled: ${totalScheduled}, Failed: ${failedToSchedule}`);

    // Report per-team game counts and check for weekly shortfalls
    for (const division of divisionMatchupsList) {
      verboseLog(`\n${division.divisionName} game counts:`);
      for (const team of division.teams) {
        const teamState = this.teamSchedulingStates.get(team.id);
        if (!teamState) continue;
        verboseLog(`  ${team.name}: ${teamState.gamesScheduled} games (${teamState.homeGames} home, ${teamState.awayGames} away)`);

        // Check each week for shortfalls and collect them
        const weeklyShortfalls: Array<{ week: number; startDate: string; endDate: string; scheduled: number; expected: number }> = [];
        for (let gameWeekIdx = 0; gameWeekIdx < gameWeeks.length; gameWeekIdx++) {
          const week = gameWeeks[gameWeekIdx];
          const gamesThisWeek = teamState.eventsPerWeek.get(week.weekNumber)?.games || 0;
          // Use game week index (1-based) for override lookup
          const expectedGamesThisWeek = this.getGamesPerWeekForDivision(division.divisionId, gameWeekIdx + 1);
          if (gamesThisWeek < expectedGamesThisWeek) {
            weeklyShortfalls.push({
              week: gameWeekIdx + 1, // Display 1-based game week number
              startDate: week.startDate,
              endDate: week.endDate,
              scheduled: gamesThisWeek,
              expected: expectedGamesThisWeek,
            });
          }
        }

        // If there are shortfalls, create a warning
        if (weeklyShortfalls.length > 0) {
          const totalExpected = this.getTotalGamesPerTeam(division.divisionId, gameWeeks);
          const totalShortfall = totalExpected - teamState.gamesScheduled;

          // Build summary with week details
          let summary = `${team.name} (${division.divisionName}) is short ${totalShortfall} game${totalShortfall > 1 ? 's' : ''} (${teamState.gamesScheduled}/${totalExpected}).`;
          summary += '\n\nWeekly breakdown:';
          for (const shortfall of weeklyShortfalls.slice(0, 10)) {
            summary += `\n  ${shortfall.startDate} to ${shortfall.endDate}: ${shortfall.scheduled}/${shortfall.expected} games`;
          }
          if (weeklyShortfalls.length > 10) {
            summary += `\n  (${weeklyShortfalls.length - 10} more weeks not shown)`;
          }

          // Look for failed matchup diagnostics for this team
          const failedMatchups = this.schedulingLog
            .filter(entry =>
              entry.category === 'game' &&
              entry.level === 'warning' &&
              entry.message.includes('Failed to schedule matchup') &&
              (entry.details?.homeTeamId === team.id || entry.details?.awayTeamId === team.id)
            )
            .slice(0, 5);

          if (failedMatchups.length > 0) {
            summary += '\n\nFailed matchups:';
            for (const entry of failedMatchups) {
              summary += `\n  ${entry.message}`;
              if (entry.details?.reason) {
                summary += `\n    Week: ${entry.details.weekDates || 'unknown'}`;
                summary += `\n    Reason: ${entry.details.reason}`;
              }
            }
          }

          this.warnings.push({
            type: 'insufficient_resources',
            message: `Team ${team.name} (${division.divisionName}) only got ${teamState.gamesScheduled}/${totalExpected} games`,
            summary,
            details: {
              teamId: team.id,
              teamName: team.name,
              divisionId: division.divisionId,
              divisionName: division.divisionName,
              scheduled: teamState.gamesScheduled,
              needed: totalExpected,
              weeklyShortfalls,
            },
          });

          this.log('error', 'game', `Game requirement not met for ${team.name} (${division.divisionName}): ${teamState.gamesScheduled}/${totalExpected} games scheduled`, {
            teamId: team.id,
            teamName: team.name,
            divisionId: division.divisionId,
            divisionName: division.divisionName,
            gamesScheduled: teamState.gamesScheduled,
            gamesNeeded: totalExpected,
            weeklyShortfalls,
          }, summary);
        }
      }
    }

    // Analyze game day preference compliance for each division
    this.analyzeGameDayPreferenceCompliance(divisionMatchupsList, gameWeeks);
  }

  /**
   * Analyze game day preference compliance and log detailed diagnostics when teams
   * don't get games on required days.
   */
  private analyzeGameDayPreferenceCompliance(
    divisionMatchupsList: Array<{
      divisionId: string;
      divisionName: string;
      teams: Team[];
      config: { gamesPerWeek: number; gameDurationHours: number };
    }>,
    gameWeeks: WeekDefinition[]
  ): void {
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const division of divisionMatchupsList) {
      const preferences = this.scoringContext?.gameDayPreferences.get(division.divisionId) || [];
      const requiredDays = preferences.filter(p => p.priority === 'required');

      if (requiredDays.length === 0) continue; // No required days configured

      verboseLog(`\n${division.divisionName} - Game Day Preference Analysis:`);

      for (const team of division.teams) {
        const teamState = this.teamSchedulingStates.get(team.id);
        if (!teamState) continue;

        // Get all games for this team
        const teamGames = this.scheduledEvents.filter(e =>
          e.eventType === 'game' &&
          (e.homeTeamId === team.id || e.awayTeamId === team.id)
        );

        // Count games by day of week
        const gamesByDay = new Map<number, number>();
        for (const game of teamGames) {
          const date = new Date(game.date + 'T12:00:00');
          const dayOfWeek = date.getDay();
          gamesByDay.set(dayOfWeek, (gamesByDay.get(dayOfWeek) || 0) + 1);
        }

        // Check each required day
        for (const reqDay of requiredDays) {
          const gamesOnRequiredDay = gamesByDay.get(reqDay.dayOfWeek) || 0;
          const dayName = DAY_NAMES[reqDay.dayOfWeek];
          const expectedGamesOnDay = gameWeeks.length; // Ideally 1 game per week on required day

          if (gamesOnRequiredDay < expectedGamesOnDay) {
            const shortfall = expectedGamesOnDay - gamesOnRequiredDay;

            // Collect detailed diagnostics about why games couldn't be scheduled on required day
            const diagnostics = this.diagnoseRequiredDayShortfall(
              team,
              division,
              reqDay.dayOfWeek,
              gameWeeks
            );

            let summary = `${team.name} only has ${gamesOnRequiredDay}/${expectedGamesOnDay} games on ${dayName} (required day).\n`;
            summary += `\nWeeks without a ${dayName} game:\n`;
            for (const diag of diagnostics.weeksMissingGame.slice(0, 10)) {
              summary += `  ${diag.weekDates}: ${diag.reason}\n`;
            }
            if (diagnostics.weeksMissingGame.length > 10) {
              summary += `  (${diagnostics.weeksMissingGame.length - 10} more weeks not shown)\n`;
            }

            if (diagnostics.fieldSlotAvailability.length > 0) {
              summary += `\n${dayName} field slot availability:\n`;
              for (const slot of diagnostics.fieldSlotAvailability.slice(0, 5)) {
                summary += `  ${slot.date}: ${slot.slotsAvailable} slots, ${slot.slotsUsed} used`;
                if (slot.usedBy.length > 0) {
                  summary += ` (by: ${slot.usedBy.slice(0, 3).join(', ')}${slot.usedBy.length > 3 ? '...' : ''})`;
                }
                summary += '\n';
              }
            }

            verboseLog(`  ⚠️ ${team.name}: ${gamesOnRequiredDay}/${expectedGamesOnDay} ${dayName} games`);

            this.log('warning', 'game', `${team.name} missing ${shortfall} games on required day (${dayName})`, {
              teamId: team.id,
              teamName: team.name,
              divisionId: division.divisionId,
              divisionName: division.divisionName,
              requiredDay: reqDay.dayOfWeek,
              requiredDayName: dayName,
              gamesOnRequiredDay,
              expectedGamesOnDay,
              shortfall,
              totalGames: teamGames.length,
              gameDistribution: Object.fromEntries(
                Array.from(gamesByDay.entries()).map(([day, count]) => [DAY_NAMES[day], count])
              ),
              weeksMissingGame: diagnostics.weeksMissingGame,
              fieldSlotAvailability: diagnostics.fieldSlotAvailability,
            }, summary);
          }
        }
      }
    }
  }

  /**
   * Diagnose why a team doesn't have a game on a required day for certain weeks.
   */
  private diagnoseRequiredDayShortfall(
    team: Team,
    division: { divisionId: string; divisionName: string; config: { gamesPerWeek: number; gameDurationHours: number } },
    requiredDayOfWeek: number,
    gameWeeks: WeekDefinition[]
  ): {
    weeksMissingGame: Array<{ weekDates: string; reason: string }>;
    fieldSlotAvailability: Array<{ date: string; slotsAvailable: number; slotsUsed: number; usedBy: string[] }>;
  } {
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const requiredDayName = DAY_NAMES[requiredDayOfWeek];

    const weeksMissingGame: Array<{ weekDates: string; reason: string }> = [];
    const fieldSlotAvailability: Array<{ date: string; slotsAvailable: number; slotsUsed: number; usedBy: string[] }> = [];

    // Get all games for this team
    const teamGames = this.scheduledEvents.filter(e =>
      e.eventType === 'game' &&
      (e.homeTeamId === team.id || e.awayTeamId === team.id)
    );

    // Get all dates where this team has a game
    const teamGameDates = new Set(teamGames.map(g => g.date));

    for (let gameWeekIdx = 0; gameWeekIdx < gameWeeks.length; gameWeekIdx++) {
      const week = gameWeeks[gameWeekIdx];
      // Find the required day date in this week
      const requiredDayDate = week.dates.find(date => {
        const d = new Date(date + 'T12:00:00');
        return d.getDay() === requiredDayOfWeek;
      });

      if (!requiredDayDate) {
        weeksMissingGame.push({
          weekDates: `${week.startDate} to ${week.endDate}`,
          reason: `No ${requiredDayName} in this week`,
        });
        continue;
      }

      // Check if team has a game on this date
      if (teamGameDates.has(requiredDayDate)) {
        continue; // Team has a game on the required day this week
      }

      // Team doesn't have a game on required day - diagnose why

      // Check if team already has enough games this week
      const teamState = this.teamSchedulingStates.get(team.id);
      const gamesThisWeek = teamState?.eventsPerWeek.get(week.weekNumber)?.games || 0;
      // Use game week index (1-based) for override lookup
      const gamesPerWeekQuota = this.getGamesPerWeekForDivision(division.divisionId, gameWeekIdx + 1);
      if (gamesThisWeek >= gamesPerWeekQuota) {
        weeksMissingGame.push({
          weekDates: `${week.startDate} to ${week.endDate}`,
          reason: `Already at game quota (${gamesThisWeek}/${gamesPerWeekQuota}) - games on other days`,
        });
        continue;
      }

      // Check if there are field slots available on required day for this division
      const requiredDaySlots = this.gameFieldSlots.filter(rs =>
        rs.slot.date === requiredDayDate &&
        this.isFieldCompatibleWithDivision(rs.resourceId, division.divisionId)
      );

      if (requiredDaySlots.length === 0) {
        weeksMissingGame.push({
          weekDates: `${week.startDate} to ${week.endDate}`,
          reason: `No compatible field slots on ${requiredDayName} (${requiredDayDate})`,
        });
        continue;
      }

      // Check what's scheduled on those slots
      const gamesOnRequiredDay = this.scheduledEvents.filter(e =>
        e.eventType === 'game' && e.date === requiredDayDate
      );

      const usedBy = gamesOnRequiredDay.map(g => {
        const homeTeam = this.teams.find(t => t.id === g.homeTeamId);
        const awayTeam = this.teams.find(t => t.id === g.awayTeamId);
        return `${homeTeam?.name || 'Unknown'} vs ${awayTeam?.name || 'Unknown'}`;
      });

      fieldSlotAvailability.push({
        date: requiredDayDate,
        slotsAvailable: requiredDaySlots.length,
        slotsUsed: gamesOnRequiredDay.length,
        usedBy,
      });

      // Check if team has another event on this date blocking them
      const teamEventsOnDate = this.scheduledEvents.filter(e =>
        e.date === requiredDayDate &&
        (e.teamId === team.id || e.homeTeamId === team.id || e.awayTeamId === team.id)
      );

      if (teamEventsOnDate.length > 0) {
        const eventTypes = teamEventsOnDate.map(e => e.eventType).join(', ');
        weeksMissingGame.push({
          weekDates: `${week.startDate} to ${week.endDate}`,
          reason: `Team has other event(s) on ${requiredDayDate}: ${eventTypes}`,
        });
        continue;
      }

      // All slots might be taken by other teams
      if (gamesOnRequiredDay.length >= requiredDaySlots.length) {
        weeksMissingGame.push({
          weekDates: `${week.startDate} to ${week.endDate}`,
          reason: `All ${requiredDaySlots.length} ${requiredDayName} slots used by other teams`,
        });
        continue;
      }

      // There are slots available but team still didn't get one - likely scheduling order issue
      weeksMissingGame.push({
        weekDates: `${week.startDate} to ${week.endDate}`,
        reason: `Slots available (${requiredDaySlots.length - gamesOnRequiredDay.length} unused) but not assigned - check matchup order or conflicts`,
      });
    }

    return { weeksMissingGame, fieldSlotAvailability };
  }

  /**
   * Assign matchups to weeks ensuring 2-regularity (each team plays exactly gamesPerWeek per week).
   * This uses a greedy algorithm that tracks team availability per week.
   *
   * The algorithm:
   * 1. For each week, we need (numTeams * gamesPerWeek / 2) matchups
   * 2. For each matchup, find the earliest week where both teams still have capacity
   * 3. Assign the matchup to that week
   *
   * To spread rematches out, we process matchups in round-robin round order,
   * which naturally spaces out games between the same two teams.
   */
  private assignMatchupsToWeeks(
    matchups: Array<GameMatchup & { targetWeek: number }>,
    numWeeks: number,
    gamesPerWeek: number,
    teamIds: string[]
  ): Array<GameMatchup & { targetWeek: number }> {
    // Track how many games each team has in each week
    const teamWeekGames = new Map<string, Map<number, number>>();
    for (const teamId of teamIds) {
      teamWeekGames.set(teamId, new Map());
    }

    const getTeamGamesInWeek = (teamId: string, week: number): number => {
      return teamWeekGames.get(teamId)?.get(week) || 0;
    };

    const addTeamGameInWeek = (teamId: string, week: number): void => {
      const weekMap = teamWeekGames.get(teamId)!;
      weekMap.set(week, (weekMap.get(week) || 0) + 1);
    };

    const canScheduleInWeek = (homeTeamId: string, awayTeamId: string, week: number): boolean => {
      return (
        getTeamGamesInWeek(homeTeamId, week) < gamesPerWeek &&
        getTeamGamesInWeek(awayTeamId, week) < gamesPerWeek
      );
    };

    // Calculate expected matchups per week
    const matchupsPerWeek = (teamIds.length * gamesPerWeek) / 2;
    const weekMatchupCount = new Map<number, number>();

    const result: Array<GameMatchup & { targetWeek: number }> = [];

    // Process matchups in their original order (round-robin order helps spread rematches)
    for (const matchup of matchups) {
      // Find the best week for this matchup
      // Strategy: prefer weeks that are less full, starting from week 0
      let bestWeek = -1;
      let bestWeekScore = Infinity;

      for (let week = 0; week < numWeeks; week++) {
        if (!canScheduleInWeek(matchup.homeTeamId, matchup.awayTeamId, week)) {
          continue;
        }

        // Score this week: prefer weeks that are less full
        // This helps balance matchups across weeks
        const currentMatchups = weekMatchupCount.get(week) || 0;

        // Penalize weeks that are already at or above target
        const overTarget = Math.max(0, currentMatchups - matchupsPerWeek + 1);
        const score = currentMatchups + (overTarget * 100);

        if (score < bestWeekScore) {
          bestWeekScore = score;
          bestWeek = week;
        }
      }

      if (bestWeek === -1) {
        // No valid week found - this means the math doesn't work out
        // Log detailed diagnostics
        const homeTeam = this.teams.find(t => t.id === matchup.homeTeamId);
        const awayTeam = this.teams.find(t => t.id === matchup.awayTeamId);
        const homeTeamName = homeTeam?.name || matchup.homeTeamId;
        const awayTeamName = awayTeam?.name || matchup.awayTeamId;

        const homeGamesPerWeek = Array.from({ length: numWeeks }, (_, w) => `W${w + 1}:${getTeamGamesInWeek(matchup.homeTeamId, w)}`).join(', ');
        const awayGamesPerWeek = Array.from({ length: numWeeks }, (_, w) => `W${w + 1}:${getTeamGamesInWeek(matchup.awayTeamId, w)}`).join(', ');

        console.warn(`⚠️ Could not find valid week for matchup ${homeTeamName} vs ${awayTeamName}`);
        console.warn(`   ${homeTeamName} games per week: ${homeGamesPerWeek}`);
        console.warn(`   ${awayTeamName} games per week: ${awayGamesPerWeek}`);

        // Log to scheduling log so it shows up in the UI
        const summary = `Could not find valid week for matchup ${homeTeamName} vs ${awayTeamName}.\n` +
          `Both teams are already at ${gamesPerWeek} games/week in all weeks.\n` +
          `${homeTeamName}: ${homeGamesPerWeek}\n` +
          `${awayTeamName}: ${awayGamesPerWeek}`;

        this.log('error', 'game', `No valid week for matchup: ${homeTeamName} vs ${awayTeamName}`, {
          homeTeamId: matchup.homeTeamId,
          awayTeamId: matchup.awayTeamId,
          homeTeamName,
          awayTeamName,
          gamesPerWeek,
          numWeeks,
          homeGamesPerWeek,
          awayGamesPerWeek,
        }, summary);

        // Still need to assign it somewhere for the scheduling phase to report properly
        // Find the week with the fewest games for the home team (will fail during scheduling)
        let leastFullWeek = 0;
        let leastGames = Infinity;
        for (let week = 0; week < numWeeks; week++) {
          const homeGames = getTeamGamesInWeek(matchup.homeTeamId, week);
          if (homeGames < leastGames) {
            leastGames = homeGames;
            leastFullWeek = week;
          }
        }
        bestWeek = leastFullWeek;
      }

      // Assign matchup to best week
      result.push({
        ...matchup,
        targetWeek: bestWeek,
      });

      // Update tracking (even for "invalid" assignments so we can see the overflow)
      addTeamGameInWeek(matchup.homeTeamId, bestWeek);
      addTeamGameInWeek(matchup.awayTeamId, bestWeek);
      weekMatchupCount.set(bestWeek, (weekMatchupCount.get(bestWeek) || 0) + 1);
    }

    // Log the distribution for debugging
    verboseLog(`  Matchup-to-week assignment:`);
    for (let week = 0; week < numWeeks; week++) {
      const count = weekMatchupCount.get(week) || 0;
      const status = count === matchupsPerWeek ? '✓' : (count < matchupsPerWeek ? '⚠ under' : '⚠ over');
      verboseLog(`    Week ${week + 1}: ${count} matchups ${status}`);
    }

    // Verify team distribution
    let allTeamsBalanced = true;
    for (const teamId of teamIds) {
      const weekMap = teamWeekGames.get(teamId)!;
      for (let week = 0; week < numWeeks; week++) {
        const games = weekMap.get(week) || 0;
        if (games !== gamesPerWeek) {
          allTeamsBalanced = false;
          const team = this.teams.find(t => t.id === teamId);
          verboseLog(`    ⚠ ${team?.name || teamId} has ${games} games in week ${week + 1} (expected ${gamesPerWeek})`);
        }
      }
    }
    if (allTeamsBalanced) {
      verboseLog(`  ✓ All teams have exactly ${gamesPerWeek} games per week`);
    }

    return result;
  }

  /**
   * Rebalance home/away assignments to minimize imbalance.
   * This is needed when we use partial round-robin cycles.
   *
   * Strategy: For teams with imbalance > 1, find matchups where swapping
   * home/away would improve overall balance.
   */
  private rebalanceHomeAway(
    matchups: Array<GameMatchup & { targetWeek: number }>,
    teams: Team[]
  ): void {
    // Calculate current balance
    const getBalance = () => {
      const homeCount = new Map<string, number>();
      const awayCount = new Map<string, number>();
      for (const m of matchups) {
        homeCount.set(m.homeTeamId, (homeCount.get(m.homeTeamId) || 0) + 1);
        awayCount.set(m.awayTeamId, (awayCount.get(m.awayTeamId) || 0) + 1);
      }
      return { homeCount, awayCount };
    };

    const getImbalance = (teamId: string, homeCount: Map<string, number>, awayCount: Map<string, number>) => {
      return (homeCount.get(teamId) || 0) - (awayCount.get(teamId) || 0);
    };

    const getMaxImbalance = (homeCount: Map<string, number>, awayCount: Map<string, number>) => {
      let max = 0;
      for (const team of teams) {
        max = Math.max(max, Math.abs(getImbalance(team.id, homeCount, awayCount)));
      }
      return max;
    };

    let { homeCount, awayCount } = getBalance();
    let maxImbalance = getMaxImbalance(homeCount, awayCount);

    if (maxImbalance <= 1) {
      verboseLog(`  Home/away balance OK (max imbalance: ${maxImbalance})`);
      return;
    }

    verboseLog(`  Rebalancing home/away (initial max imbalance: ${maxImbalance})...`);

    // Try swapping matchups to reduce imbalance
    let improved = true;
    let iterations = 0;
    const maxIterations = matchups.length * 2; // Safety limit

    while (improved && iterations < maxIterations && maxImbalance > 1) {
      improved = false;
      iterations++;

      for (const matchup of matchups) {
        const homeImbalance = getImbalance(matchup.homeTeamId, homeCount, awayCount);
        const awayImbalance = getImbalance(matchup.awayTeamId, homeCount, awayCount);

        // If home team has too many home games and away team has too few (or vice versa),
        // swapping would help both
        if (homeImbalance > 0 && awayImbalance < 0) {
          // Swap: home team loses a home game, away team gains one
          const newHomeImbalance = homeImbalance - 2; // -1 home, +1 away = -2
          const newAwayImbalance = awayImbalance + 2; // +1 home, -1 away = +2

          // Only swap if it improves or maintains the max imbalance
          const currentMax = Math.max(Math.abs(homeImbalance), Math.abs(awayImbalance));
          const newMax = Math.max(Math.abs(newHomeImbalance), Math.abs(newAwayImbalance));

          if (newMax < currentMax) {
            // Perform swap
            const temp = matchup.homeTeamId;
            matchup.homeTeamId = matchup.awayTeamId;
            matchup.awayTeamId = temp;

            // Update counts
            homeCount.set(matchup.homeTeamId, (homeCount.get(matchup.homeTeamId) || 0) + 1);
            homeCount.set(matchup.awayTeamId, (homeCount.get(matchup.awayTeamId) || 0) - 1);
            awayCount.set(matchup.awayTeamId, (awayCount.get(matchup.awayTeamId) || 0) + 1);
            awayCount.set(matchup.homeTeamId, (awayCount.get(matchup.homeTeamId) || 0) - 1);

            improved = true;
            maxImbalance = getMaxImbalance(homeCount, awayCount);
          }
        }
      }
    }

    verboseLog(`  Rebalancing complete after ${iterations} iterations (final max imbalance: ${maxImbalance})`);
  }

  private getWeeksToTry(targetWeek: number, totalWeeks: number): number[] {
    const weeks: number[] = [targetWeek];
    let offset = 1;

    // Expand outward from target week
    while (weeks.length < totalWeeks) {
      if (targetWeek + offset < totalWeeks) {
        weeks.push(targetWeek + offset);
      }
      if (targetWeek - offset >= 0) {
        weeks.push(targetWeek - offset);
      }
      offset++;
    }

    return weeks;
  }

  /**
   * Schedule practices for all teams using draft-based allocation
   * Round-robin ensures fair distribution of slots across teams
   */
  private async schedulePractices(): Promise<void> {
    verboseLog('\n--- Scheduling Practices (Draft-Based) ---');
    verboseLog(`Total teams: ${this.teams.length}`);
    this.log('info', 'practice', 'Starting draft-based practice scheduling phase');

    if (!this.scoringContext) {
      throw new Error('Scoring context not initialized');
    }

    // Get the WeekDefinitions that have practice dates (all season dates are practice dates)
    const practiceWeeks = this.weekDefinitions.filter((week) =>
      week.dates.some((date) => this.isPracticeDateAllowed(date))
    );
    verboseLog(`Total weeks for practices: ${practiceWeeks.length}`);
    this.log('info', 'practice', `Scheduling practices across ${practiceWeeks.length} weeks using draft allocation`, {
      firstWeek: practiceWeeks[0]?.startDate,
      lastWeek: practiceWeeks[practiceWeeks.length - 1]?.endDate,
    });

    // Get field slots compatible with practices
    const practiceFieldSlots = this.practiceFieldSlots;

    // Process week by week
    for (const week of practiceWeeks) {
      verboseLog(`\nWeek ${week.weekNumber + 1} (${week.startDate} to ${week.endDate}):`);

      // Get teams that need practices this week, sorted by who is furthest behind their target
      // Use week number as tiebreaker for teams with the same deficit (fairness rotation)
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

          // Primary sort: Higher deficit = more behind = should go first
          if (deficitA !== deficitB) {
            return deficitB - deficitA;
          }

          // Tiebreaker: rotate priority based on week number for fairness among equal-deficit teams
          // Use team name hash + week number to create a rotating priority
          const hashA = a.teamName.charCodeAt(0) + week.weekNumber;
          const hashB = b.teamName.charCodeAt(0) + week.weekNumber;
          return (hashA % 100) - (hashB % 100);
        });

      // Don't rotate anymore - deficit sorting with tiebreaker handles fairness
      const rotatedByWeek = teamsNeedingPractices;

      if (rotatedByWeek.length === 0) {
        verboseLog('  No teams need practices this week');
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

      // Pre-compute week dates as a Set for O(1) lookup
      const weekDatesSet = new Set(week.dates);

      // Pre-compute week slots once (used multiple times below)
      const allWeekSlots = practiceFieldSlots.filter((rs) => weekDatesSet.has(rs.slot.date));

      // Count available slots in this week (unique date+time+resource combinations)
      const uniqueSlotKeys = new Set(allWeekSlots.map(s => `${s.slot.date}|${s.slot.startTime}|${s.resourceId}`));
      const availableSlots = uniqueSlotKeys.size;

      verboseLog(`  Capacity check: ${totalPracticesNeeded} practices needed, ${availableSlots} unique slots available`);

      if (availableSlots < totalPracticesNeeded) {
        this.log('warning', 'practice', `Insufficient practice capacity in week ${week.weekNumber + 1}`, {
          weekNumber: week.weekNumber + 1,
          weekStart: week.startDate,
          weekEnd: week.endDate,
          practicesNeeded: totalPracticesNeeded,
          slotsAvailable: availableSlots,
          teamsNeedingPractices: teamsNeedingPractices.length,
          shortfall: totalPracticesNeeded - availableSlots,
          datesWithSlots: [...new Set(allWeekSlots.map(s => s.slot.date))].sort(),
        });
        verboseLog(`  ⚠️  CAPACITY WARNING: Need ${totalPracticesNeeded} practices but only ${availableSlots} slots available (shortfall: ${totalPracticesNeeded - availableSlots})`);
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

            // Primary: higher deficit goes first
            if (deficitA !== deficitB) {
              return deficitB - deficitA;
            }

            // Tiebreaker: rotate priority based on round + week for fairness
            const hashA = a.teamName.charCodeAt(0) + week.weekNumber + round;
            const hashB = b.teamName.charCodeAt(0) + week.weekNumber + round;
            return (hashA % 100) - (hashB % 100);
          });

        if (stillNeedPractices.length === 0) {
          verboseLog(`  All teams met practice requirements for this week`);
          break;
        }

        // Compute slot availability for scarcity calculation
        this.computeTeamSlotAvailability(stillNeedPractices, practiceFieldSlots, week);

        // Use sorted order directly - deficit sorting with tiebreaker handles fairness
        verboseLog(`  Round ${round + 1}: ${stillNeedPractices.length} teams still need practices`);

        let anyScheduledThisRound = false;

        for (const teamState of stillNeedPractices) {
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

          // Filter pre-computed week slots to those compatible with this team's division
          const weekSlots = allWeekSlots.filter((rs) =>
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
            verboseLog(`    ${teamState.teamName}: No candidates available - investigating...`);
            verboseLog(`      Week slots available: ${weekSlots.length}`);
            verboseLog(`      Practice duration required: ${config.practiceDurationHours}h`);

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

          // Score and select the best candidate using two-phase approach:
          // 1. Select field based on earliestTime, resourceUtilization, etc. (not timeAdjacency)
          // 2. Select best time slot on that field (using timeAdjacency to pack events)
          const bestCandidate = selectBestCandidateTwoPhase(
            candidates,
            teamState,
            this.scoringContext,
            this.scoringWeights
          );

          if (!bestCandidate) {
            verboseLog(`    ${teamState.teamName}: No valid candidate found`);
            continue;
          }

          // Convert to event draft and add to scheduled events
          const eventDraft = candidateToEventDraft(bestCandidate, teamState.divisionId);
          this.scheduledEvents.push(eventDraft);
          addEventToContext(this.scoringContext, eventDraft);

          // Update team state
          updateTeamStateAfterScheduling(teamState, eventDraft, week.weekNumber);

          // Update resource usage in scoring context
          const durationHours = config.practiceDurationHours;
          updateResourceUsage(this.scoringContext, bestCandidate.resourceId, bestCandidate.date, durationHours);

          const dayName = ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek];
          verboseLog(`    ✅ ${teamState.teamName}: ${bestCandidate.date} (${dayName}) ${bestCandidate.startTime}-${bestCandidate.endTime} @ ${bestCandidate.resourceName} (score: ${bestCandidate.score.toFixed(1)})`);

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
          verboseLog(`  No practices scheduled this round, moving to next week`);
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
            verboseLog(`  ⚠️  Teams that still need practices this week but couldn't be scheduled:`);
            for (const ts of unscheduledTeams) {
              const weekEvents = ts.eventsPerWeek.get(week.weekNumber) || { games: 0, practices: 0, cages: 0 };
              const cfg = this.divisionConfigs.get(ts.divisionId);
              verboseLog(`      - ${ts.teamName}: has ${weekEvents.practices}/${cfg?.practicesPerWeek || '?'} practices, field dates: [${Array.from(ts.fieldDatesUsed).sort().join(', ')}]`);

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
        verboseLog(`  ⚠️  Reached max rounds limit for week ${week.weekNumber + 1}`);
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
    verboseLog(`\n✅ Practice scheduling complete. Total scheduled: ${totalPractices}`);

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
      verboseLog(`      ⚠️  No constraint found for team ${teamId}`);
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

    verboseLog(`      Field availability windows in this week: ${fieldSlots.length}`);

    const skipReasons: Record<string, number> = {};
    const skipDetails: Array<{ date: string; field: string; reason: string }> = [];

    // Find available windows that can accommodate the practice duration
    for (const rs of fieldSlots) {
      const dayName = ScheduleGenerator.DAY_NAMES[rs.slot.dayOfWeek];

      // Check if team already has event on this date - use index for O(1) lookup
      let teamHasEventToday = false;
      if (this.scoringContext?.eventsByDateTeam) {
        const key = `${rs.slot.date}-${teamId}`;
        const teamEvents = this.scoringContext.eventsByDateTeam.get(key);
        teamHasEventToday = teamEvents !== undefined && teamEvents.length > 0;
      } else {
        teamHasEventToday = this.scheduledEvents.some(event =>
          event.date === rs.slot.date &&
          (event.teamId === teamId || event.homeTeamId === teamId || event.awayTeamId === teamId)
        );
      }

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
        verboseLog(`      ✅ Chose slot: ${rs.slot.date} ${availableTime.startTime}-${availableTime.endTime} at field ${rs.resourceId}`);

        const eventDraft = {
          seasonId: this.season.id,
          divisionId,
          eventType: 'practice' as const,
          date: rs.slot.date,
          startTime: availableTime.startTime,
          endTime: availableTime.endTime,
          fieldId: rs.resourceId,
          teamId,
        };
        this.scheduledEvents.push(eventDraft);
        addEventToContext(this.scoringContext!, eventDraft);

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

    verboseLog(`      ❌ No suitable time found in any availability window this week`);
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
          const practiceEvent = {
            seasonId: this.season.id,
            divisionId,
            eventType: 'practice' as const,
            date,
            startTime: fieldStart,
            endTime: fieldEnd,
            fieldId: fieldSlot.resourceId,
            teamId,
          };
          this.scheduledEvents.push(practiceEvent);
          addEventToContext(this.scoringContext!, practiceEvent);

          const cageEvent = {
            seasonId: this.season.id,
            divisionId,
            eventType: 'cage' as const,
            date,
            startTime: cageStart,
            endTime: cageEnd,
            cageId: cageSlot.resourceId,
            teamId,
          };
          this.scheduledEvents.push(cageEvent);
          addEventToContext(this.scoringContext!, cageEvent);

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
          const cageEventAlt = {
            seasonId: this.season.id,
            divisionId,
            eventType: 'cage' as const,
            date,
            startTime: cageStartAlt,
            endTime: cageEndAlt,
            cageId: cageSlot.resourceId,
            teamId,
          };
          this.scheduledEvents.push(cageEventAlt);
          addEventToContext(this.scoringContext!, cageEventAlt);

          const practiceEventAlt = {
            seasonId: this.season.id,
            divisionId,
            eventType: 'practice' as const,
            date,
            startTime: fieldStartAlt,
            endTime: fieldEndAlt,
            fieldId: fieldSlot.resourceId,
            teamId,
          };
          this.scheduledEvents.push(practiceEventAlt);
          addEventToContext(this.scoringContext!, practiceEventAlt);

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
    // Use index for O(1) lookup
    if (this.scoringContext?.eventsByDateResource) {
      const key = `${date}-${resourceId}`;
      const resourceEvents = this.scoringContext.eventsByDateResource.get(key);
      if (!resourceEvents || resourceEvents.length === 0) return false;
      return resourceEvents.some(event =>
        this.timesOverlap(event.startTime, event.endTime, startTime, endTime)
      );
    }
    // Fallback to full scan
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
    verboseLog('\n--- Scheduling Cage Sessions (Draft-Based) ---');
    verboseLog(`Total teams: ${this.teams.length}`);
    this.log('info', 'cage', 'Starting draft-based cage session scheduling phase');

    if (!this.scoringContext) {
      throw new Error('Scoring context not initialized');
    }

    // Get the WeekDefinitions that have cage dates (all season dates allow cages)
    const cageWeeks = this.weekDefinitions.filter((week) =>
      week.dates.some((date) => this.isPracticeDateAllowed(date))
    );
    verboseLog(`Total weeks for cages: ${cageWeeks.length}`);
    this.log('info', 'cage', `Scheduling cage sessions across ${cageWeeks.length} weeks using draft allocation`, {
      firstWeek: cageWeeks[0]?.startDate,
      lastWeek: cageWeeks[cageWeeks.length - 1]?.endDate,
    });

    // Process week by week
    for (const week of cageWeeks) {
      verboseLog(`\nWeek ${week.weekNumber + 1} (${week.startDate} to ${week.endDate}):`);

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
        verboseLog('  No teams need cage sessions this week');
        continue;
      }

      // Pre-compute week dates as a Set for O(1) lookup
      const weekDatesSet = new Set(week.dates);

      // Pre-compute all cage slots for this week once
      const allWeekCageSlots = this.cageSlots.filter((rs) => weekDatesSet.has(rs.slot.date));

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
          verboseLog(`  All teams met cage requirements for this week`);
          break;
        }

        // Rotate team order within round for fairness among teams with similar deficits
        const rotatedTeams = rotateArray(stillNeedCages, round);
        verboseLog(`  Round ${round + 1}: ${rotatedTeams.length} teams still need cage sessions`);

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

          // Filter pre-computed week cage slots to those compatible with this team's division
          const weekSlots = allWeekCageSlots
            .filter((rs) =>
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
            verboseLog(`    ${teamState.teamName}: No candidates available`);

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
            verboseLog(`    ${teamState.teamName}: No valid candidate found`);
            continue;
          }

          // Convert to event draft and add to scheduled events
          const eventDraft = candidateToEventDraft(bestCandidate, teamState.divisionId);
          this.scheduledEvents.push(eventDraft);
          addEventToContext(this.scoringContext, eventDraft);

          // Update team state
          updateTeamStateAfterScheduling(teamState, eventDraft, week.weekNumber);

          // Update resource usage in scoring context
          updateResourceUsage(this.scoringContext, bestCandidate.resourceId, bestCandidate.date, cageSessionDuration);

          const dayName = ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek];
          verboseLog(`    ✅ ${teamState.teamName}: ${bestCandidate.date} (${dayName}) ${bestCandidate.startTime}-${bestCandidate.endTime} @ ${bestCandidate.resourceName} (score: ${bestCandidate.score.toFixed(1)})`);

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
          verboseLog(`  No cage sessions scheduled this round, moving to next week`);
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
        verboseLog(`  ⚠️  Reached max rounds limit for week ${week.weekNumber + 1}`);
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
    verboseLog(`\n✅ Cage session scheduling complete. Total scheduled: ${totalCageSessions}`);
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
      verboseLog(`      ⚠️  No constraint found for team ${teamId}`);
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
    verboseLog(`      Cage availability windows in this week: ${filteredCageSlots.length}`);

    // Use division-configured cage session duration, default to 1 hour
    const cageSessionDuration = config?.cageSessionDurationHours ?? 1;

    const skipReasons: Record<string, number> = {};
    const skipDetails: Array<{ date: string; cage: string; reason: string }> = [];

    // Find available windows that can accommodate a cage session
    for (const rs of filteredCageSlots) {
      const dayName = ScheduleGenerator.DAY_NAMES[rs.slot.dayOfWeek];

      // On weekdays, skip days where team already has a practice
      if (this.isWeekday(rs.slot.dayOfWeek)) {
        let teamHasPracticeToday = false;
        if (this.scoringContext?.eventsByDateTeam) {
          const key = `${rs.slot.date}-${teamId}`;
          const teamEvents = this.scoringContext.eventsByDateTeam.get(key);
          teamHasPracticeToday = teamEvents?.some(e => e.eventType === 'practice') ?? false;
        } else {
          teamHasPracticeToday = this.scheduledEvents.some(event =>
            event.date === rs.slot.date &&
            event.eventType === 'practice' &&
            event.teamId === teamId
          );
        }
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
        verboseLog(`      ✅ Chose slot: ${rs.slot.date} ${result.time.startTime}-${result.time.endTime} at cage ${rs.resourceId}`);

        const cageEventDraft = {
          seasonId: this.season.id,
          divisionId,
          eventType: 'cage' as const,
          date: rs.slot.date,
          startTime: result.time.startTime,
          endTime: result.time.endTime,
          cageId: rs.resourceId,
          teamId,
        };
        this.scheduledEvents.push(cageEventDraft);
        addEventToContext(this.scoringContext!, cageEventDraft);

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

    verboseLog(`      ❌ No suitable time found in any availability window this week`);
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

          // Use index for O(1) lookup if available
          let hasConflict = false;
          const resourceKey = `${rs.slot.date}-${rs.resourceId}`;
          const eventsAtResource = this.scoringContext?.eventsByDateResource?.get(resourceKey);
          if (eventsAtResource && eventsAtResource.length > 0) {
            hasConflict = eventsAtResource.some((event) => {
              const eventStart = timeToMinutes(event.startTime);
              const eventEnd = timeToMinutes(event.endTime);
              return candidateStart < eventEnd && candidateEndMinutes > eventStart;
            });
          }

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
    // Use index for O(1) lookup
    let teamEventsToday: typeof this.scheduledEvents;
    if (this.scoringContext?.eventsByDateTeam) {
      const key = `${availabilityWindow.date}-${teamId}`;
      teamEventsToday = this.scoringContext.eventsByDateTeam.get(key) || [];
    } else {
      teamEventsToday = this.scheduledEvents.filter(event =>
        event.date === availabilityWindow.date &&
        (event.teamId === teamId || event.homeTeamId === teamId || event.awayTeamId === teamId)
      );
    }

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

      // Check if this time conflicts with existing events on this cage - use index
      let hasConflict = false;
      if (this.scoringContext?.eventsByDateResource) {
        const key = `${availabilityWindow.date}-${cageId}`;
        const cageEvents = this.scoringContext.eventsByDateResource.get(key);
        hasConflict = cageEvents?.some(event =>
          this.timesOverlap(event.startTime, event.endTime, candidateStartTime, candidateEndTime)
        ) ?? false;
      } else {
        hasConflict = this.scheduledEvents.some(event => {
          if (event.date !== availabilityWindow.date) return false;
          if (event.cageId !== cageId) return false;
          return this.timesOverlap(event.startTime, event.endTime, candidateStartTime, candidateEndTime);
        });
      }

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
    // Check if team already has an event on this date (same-day constraint) - use index
    let teamHasEventToday = false;
    if (this.scoringContext?.eventsByDateTeam) {
      const key = `${availabilityWindow.date}-${teamId}`;
      const teamEvents = this.scoringContext.eventsByDateTeam.get(key);
      teamHasEventToday = teamEvents !== undefined && teamEvents.length > 0;
    } else {
      teamHasEventToday = this.scheduledEvents.some(event =>
        event.date === availabilityWindow.date &&
        (event.teamId === teamId || event.homeTeamId === teamId || event.awayTeamId === teamId)
      );
    }

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

      // Check if this time conflicts with existing events on this resource - use index
      let hasConflict = false;
      if (this.scoringContext?.eventsByDateResource) {
        const key = `${availabilityWindow.date}-${resourceId}`;
        const resourceEvents = this.scoringContext.eventsByDateResource.get(key);
        hasConflict = resourceEvents?.some(event =>
          this.timesOverlap(event.startTime, event.endTime, candidateStartTime, candidateEndTime)
        ) ?? false;
      } else {
        hasConflict = this.scheduledEvents.some(event => {
          if (event.date !== availabilityWindow.date) return false;
          const eventResourceId = resourceType === 'field' ? event.fieldId : event.cageId;
          if (eventResourceId !== resourceId) return false;
          return this.timesOverlap(event.startTime, event.endTime, candidateStartTime, candidateEndTime);
        });
      }

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
    // Check if either team already has an event on this date (same-day constraint) - use index
    let homeTeamHasEventToday = false;
    let awayTeamHasEventToday = false;
    if (this.scoringContext?.eventsByDateTeam) {
      const homeKey = `${availabilityWindow.date}-${homeTeamId}`;
      const awayKey = `${availabilityWindow.date}-${awayTeamId}`;
      const homeEvents = this.scoringContext.eventsByDateTeam.get(homeKey);
      const awayEvents = this.scoringContext.eventsByDateTeam.get(awayKey);
      homeTeamHasEventToday = homeEvents !== undefined && homeEvents.length > 0;
      awayTeamHasEventToday = awayEvents !== undefined && awayEvents.length > 0;
    } else {
      homeTeamHasEventToday = this.scheduledEvents.some(event =>
        event.date === availabilityWindow.date &&
        (event.teamId === homeTeamId || event.homeTeamId === homeTeamId || event.awayTeamId === homeTeamId)
      );
      awayTeamHasEventToday = this.scheduledEvents.some(event =>
        event.date === availabilityWindow.date &&
        (event.teamId === awayTeamId || event.homeTeamId === awayTeamId || event.awayTeamId === awayTeamId)
      );
    }

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

      // Check if this time conflicts with existing events on this field - use index
      let hasConflict = false;
      if (this.scoringContext?.eventsByDateResource) {
        const key = `${availabilityWindow.date}-${fieldId}`;
        const fieldEvents = this.scoringContext.eventsByDateResource.get(key);
        hasConflict = fieldEvents?.some(event =>
          this.timesOverlap(event.startTime, event.endTime, candidateStartTime, candidateEndTime)
        ) ?? false;
      } else {
        hasConflict = this.scheduledEvents.some(event => {
          if (event.date !== availabilityWindow.date) return false;
          if (event.fieldId !== fieldId) return false;
          return this.timesOverlap(event.startTime, event.endTime, candidateStartTime, candidateEndTime);
        });
      }

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
    // Only count newly created events, excluding existing events passed in for conflict detection
    const newEvents = this.scheduledEvents.slice(this.existingEventsCount);
    const newEventsCount = newEvents.length;

    return {
      success,
      eventsCreated: newEventsCount,
      message: success
        ? `Successfully generated ${newEventsCount} events`
        : 'Failed to generate schedule',
      errors: this.errors.length > 0 ? this.errors : undefined,
      warnings: this.warnings.length > 0 ? this.warnings : undefined,
      statistics: {
        totalEvents: newEventsCount,
        eventsByType: {
          game: newEvents.filter((e) => e.eventType === 'game').length,
          practice: newEvents.filter((e) => e.eventType === 'practice').length,
          cage: newEvents.filter((e) => e.eventType === 'cage').length,
        },
        eventsByDivision: this.calculateEventsByDivision(newEvents),
        averageEventsPerTeam: this.calculateAverageEventsPerTeam(newEvents),
      },
      schedulingLog: this.schedulingLog.length > 0 ? this.schedulingLog : undefined,
    };
  }

  private calculateEventsByDivision(events: ScheduledEventDraft[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const event of events) {
      result[event.divisionId] = (result[event.divisionId] || 0) + 1;
    }
    return result;
  }

  private calculateAverageEventsPerTeam(events: ScheduledEventDraft[]): number {
    if (this.teams.length === 0) return 0;

    const eventCounts = new Map<string, number>();
    for (const event of events) {
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
   * Get the newly scheduled events (excludes existing events that were passed in for conflict detection)
   */
  getScheduledEvents(): ScheduledEventDraft[] {
    // Skip the existing events that were added at the beginning for conflict detection
    return this.scheduledEvents.slice(this.existingEventsCount);
  }
}
