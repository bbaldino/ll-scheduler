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
} from '@ll-scheduler/shared';
import type {
  SeasonPhase,
  DivisionConfig,
  Team,
  Field,
  BattingCage,
  FieldAvailability,
  CageAvailability,
  FieldDateOverride,
  CageDateOverride,
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
 */
export class ScheduleGenerator {
  private phase: SeasonPhase;
  private divisionConfigs: Map<string, DivisionConfig>;
  private teams: Team[];
  private fields: Field[];
  private cages: BattingCage[];
  private fieldAvailability: FieldAvailability[];
  private cageAvailability: CageAvailability[];
  private fieldOverrides: FieldDateOverride[];
  private cageOverrides: CageDateOverride[];

  private resourceSlots: ResourceSlot[] = [];
  private teamConstraints: Map<string, TeamConstraint> = new Map();
  private scheduledEvents: ScheduledEventDraft[] = [];
  private errors: ScheduleError[] = [];
  private warnings: ScheduleWarning[] = [];

  constructor(
    phase: SeasonPhase,
    divisionConfigs: DivisionConfig[],
    teams: Team[],
    fields: Field[],
    cages: BattingCage[],
    fieldAvailability: FieldAvailability[],
    cageAvailability: CageAvailability[],
    fieldOverrides: FieldDateOverride[],
    cageOverrides: CageDateOverride[]
  ) {
    this.phase = phase;
    this.divisionConfigs = new Map(divisionConfigs.map((dc) => [dc.divisionId, dc]));
    this.teams = teams;
    this.fields = fields;
    this.cages = cages;
    this.fieldAvailability = fieldAvailability;
    this.cageAvailability = cageAvailability;
    this.fieldOverrides = fieldOverrides;
    this.cageOverrides = cageOverrides;
  }

  /**
   * Generate the schedule
   */
  async generate(): Promise<GenerateScheduleResult> {
    try {
      // Step 1: Validate prerequisites
      if (!this.validatePrerequisites()) {
        return this.buildResult(false);
      }

      // Step 2: Build available resource slots
      this.buildResourceSlots();

      // Step 3: Build team constraints
      this.buildTeamConstraints();

      // Step 4: Schedule games (if allowed)
      if (this.phase.allowedEventTypes.includes('game')) {
        await this.scheduleGames();
      }

      // Step 5: Schedule practices (if allowed)
      if (this.phase.allowedEventTypes.includes('practice')) {
        await this.schedulePractices();
      }

      // Step 6: Schedule cage sessions (if allowed)
      if (this.phase.allowedEventTypes.includes('cage')) {
        await this.scheduleCageSessions();
      }

      return this.buildResult(true);
    } catch (error) {
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

    if (this.fields.length === 0 && this.phase.allowedEventTypes.includes('game')) {
      this.errors.push({
        type: 'no_fields',
        message: 'No fields available for scheduling games',
      });
      return false;
    }

    if (this.cages.length === 0 && this.phase.allowedEventTypes.includes('cage')) {
      this.errors.push({
        type: 'no_cages',
        message: 'No batting cages available for scheduling cage sessions',
      });
      return false;
    }

    return true;
  }

  /**
   * Build all available resource slots for the phase date range
   */
  private buildResourceSlots(): void {
    const dates = getDateRange(this.phase.startDate, this.phase.endDate);

    // Build field slots
    for (const date of dates) {
      const dayOfWeek = getDayOfWeek(date);

      // Get field availability for this day
      for (const field of this.fields) {
        const availability = this.fieldAvailability.filter(
          (a) => a.fieldId === field.id && a.dayOfWeek === dayOfWeek
        );

        for (const avail of availability) {
          // Check for date overrides
          const override = this.fieldOverrides.find(
            (o) => o.fieldId === field.id && o.date === date
          );

          if (override?.overrideType === 'blackout') {
            // Skip this slot if it's blacked out
            continue;
          }

          const startTime = override?.startTime || avail.startTime;
          const endTime = override?.endTime || avail.endTime;

          this.resourceSlots.push({
            resourceType: 'field',
            resourceId: field.id,
            resourceName: field.name,
            slot: {
              date,
              dayOfWeek,
              startTime,
              endTime,
              duration: calculateDuration(startTime, endTime),
            },
          });
        }
      }

      // Build cage slots
      for (const cage of this.cages) {
        const availability = this.cageAvailability.filter(
          (a) => a.cageId === cage.id && a.dayOfWeek === dayOfWeek
        );

        for (const avail of availability) {
          const override = this.cageOverrides.find(
            (o) => o.cageId === cage.id && o.date === date
          );

          if (override?.overrideType === 'blackout') {
            continue;
          }

          const startTime = override?.startTime || avail.startTime;
          const endTime = override?.endTime || avail.endTime;

          this.resourceSlots.push({
            resourceType: 'cage',
            resourceId: cage.id,
            resourceName: cage.name,
            slot: {
              date,
              dayOfWeek,
              startTime,
              endTime,
              duration: calculateDuration(startTime, endTime),
            },
          });
        }
      }
    }
  }

  /**
   * Build team constraints based on division configs
   */
  private buildTeamConstraints(): void {
    const phaseDurationWeeks = this.calculatePhaseDurationWeeks();

    for (const team of this.teams) {
      const config = this.divisionConfigs.get(team.divisionId);
      if (!config) continue;

      this.teamConstraints.set(team.id, {
        teamId: team.id,
        teamName: team.name,
        divisionId: team.divisionId,
        requiredGames: config.gamesPerWeek
          ? Math.floor(config.gamesPerWeek * phaseDurationWeeks)
          : 0,
        requiredPractices: Math.floor(config.practicesPerWeek * phaseDurationWeeks),
        requiredCageSessions: config.cageSessionsPerWeek
          ? Math.floor(config.cageSessionsPerWeek * phaseDurationWeeks)
          : 0,
        minDaysBetweenEvents: config.minConsecutiveDayGap || 0,
        scheduledEventDates: [],
      });
    }
  }

  /**
   * Calculate phase duration in weeks
   */
  private calculatePhaseDurationWeeks(): number {
    const start = new Date(this.phase.startDate);
    const end = new Date(this.phase.endDate);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(1, Math.ceil(days / 7));
  }

  /**
   * Schedule games using round-robin algorithm
   */
  private async scheduleGames(): Promise<void> {
    // Group teams by division
    const teamsByDivision = new Map<string, Team[]>();
    for (const team of this.teams) {
      if (!teamsByDivision.has(team.divisionId)) {
        teamsByDivision.set(team.divisionId, []);
      }
      teamsByDivision.get(team.divisionId)!.push(team);
    }

    // Generate matchups for each division
    for (const [divisionId, divisionTeams] of teamsByDivision) {
      const config = this.divisionConfigs.get(divisionId);
      if (!config || !config.gamesPerWeek) continue;

      const matchups = this.generateRoundRobinMatchups(divisionTeams, divisionId);

      // Try to schedule each matchup
      for (const matchup of matchups) {
        const scheduled = this.scheduleGameMatchup(matchup, config.gameDurationHours!);
        if (!scheduled) {
          this.warnings.push({
            type: 'insufficient_resources',
            message: `Could not schedule game between teams in division ${divisionId}`,
            details: matchup,
          });
        }
      }
    }
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
    // Get field slots with the right duration
    const suitableSlots = this.resourceSlots.filter(
      (rs) =>
        rs.resourceType === 'field' &&
        slotHasRequiredDuration(rs.slot, durationHours) &&
        !hasTimeConflict(rs.slot, rs.resourceId, 'field', this.scheduledEvents) &&
        areTeamsAvailableForMatchup(
          matchup.homeTeamId,
          matchup.awayTeamId,
          rs.slot,
          this.teamConstraints,
          this.scheduledEvents
        )
    );

    if (suitableSlots.length === 0) {
      return false;
    }

    // Use the first suitable slot
    const chosen = suitableSlots[0];

    this.scheduledEvents.push({
      seasonPhaseId: this.phase.id,
      divisionId: matchup.divisionId,
      eventType: 'game',
      date: chosen.slot.date,
      startTime: chosen.slot.startTime,
      endTime: chosen.slot.endTime,
      fieldId: chosen.resourceId,
      homeTeamId: matchup.homeTeamId,
      awayTeamId: matchup.awayTeamId,
    });

    return true;
  }

  /**
   * Schedule practices for all teams
   */
  private async schedulePractices(): Promise<void> {
    for (const team of this.teams) {
      const constraint = this.teamConstraints.get(team.id);
      const config = this.divisionConfigs.get(team.divisionId);

      if (!constraint || !config) continue;

      const practicesScheduled = countTeamEvents(
        team.id,
        'practice',
        this.scheduledEvents
      );
      const practicesNeeded = constraint.requiredPractices! - practicesScheduled;

      for (let i = 0; i < practicesNeeded; i++) {
        const scheduled = this.schedulePractice(
          team.id,
          team.divisionId,
          config.practiceDurationHours
        );
        if (!scheduled) {
          this.warnings.push({
            type: 'insufficient_resources',
            message: `Could not schedule all practices for team ${team.name}`,
            details: { teamId: team.id, practicesScheduled, practicesNeeded },
          });
          break;
        }
      }
    }
  }

  /**
   * Try to schedule a practice for a team
   */
  private schedulePractice(
    teamId: string,
    divisionId: string,
    durationHours: number
  ): boolean {
    const constraint = this.teamConstraints.get(teamId);
    if (!constraint) return false;

    const suitableSlots = this.resourceSlots.filter(
      (rs) =>
        rs.resourceType === 'field' &&
        slotHasRequiredDuration(rs.slot, durationHours) &&
        !hasTimeConflict(rs.slot, rs.resourceId, 'field', this.scheduledEvents) &&
        isTeamAvailable(teamId, rs.slot, constraint, this.scheduledEvents)
    );

    if (suitableSlots.length === 0) {
      return false;
    }

    const chosen = suitableSlots[0];

    this.scheduledEvents.push({
      seasonPhaseId: this.phase.id,
      divisionId,
      eventType: 'practice',
      date: chosen.slot.date,
      startTime: chosen.slot.startTime,
      endTime: chosen.slot.endTime,
      fieldId: chosen.resourceId,
      teamId,
    });

    return true;
  }

  /**
   * Schedule cage sessions for all teams
   */
  private async scheduleCageSessions(): Promise<void> {
    for (const team of this.teams) {
      const constraint = this.teamConstraints.get(team.id);
      const config = this.divisionConfigs.get(team.divisionId);

      if (!constraint || !config || !config.cageSessionsPerWeek) continue;

      const cageSessionsScheduled = countTeamEvents(
        team.id,
        'cage',
        this.scheduledEvents
      );
      const sessionsNeeded = constraint.requiredCageSessions! - cageSessionsScheduled;

      for (let i = 0; i < sessionsNeeded; i++) {
        const scheduled = this.scheduleCageSession(team.id, team.divisionId);
        if (!scheduled) {
          this.warnings.push({
            type: 'insufficient_resources',
            message: `Could not schedule all cage sessions for team ${team.name}`,
            details: { teamId: team.id, sessionsScheduled: cageSessionsScheduled, sessionsNeeded },
          });
          break;
        }
      }
    }
  }

  /**
   * Try to schedule a cage session for a team
   */
  private scheduleCageSession(teamId: string, divisionId: string): boolean {
    const constraint = this.teamConstraints.get(teamId);
    if (!constraint) return false;

    const suitableSlots = this.resourceSlots.filter(
      (rs) =>
        rs.resourceType === 'cage' &&
        !hasTimeConflict(rs.slot, rs.resourceId, 'cage', this.scheduledEvents) &&
        isTeamAvailable(teamId, rs.slot, constraint, this.scheduledEvents)
    );

    if (suitableSlots.length === 0) {
      return false;
    }

    const chosen = suitableSlots[0];

    this.scheduledEvents.push({
      seasonPhaseId: this.phase.id,
      divisionId,
      eventType: 'cage',
      date: chosen.slot.date,
      startTime: chosen.slot.startTime,
      endTime: chosen.slot.endTime,
      cageId: chosen.resourceId,
      teamId,
    });

    return true;
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
