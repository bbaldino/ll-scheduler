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
  rebuildEventIndexes,
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
  generateTeamPairingsForWeek,
  calculateDaysBetween,
  rebalanceMatchupsHomeAway,
  hasWarmupConflict,
  compareCandidatesForTiebreak,
} from './draft.js';

/**
 * Check if two matchups share a team (would conflict if scheduled on same day)
 */
function sharesTeam(a: GameMatchup, b: GameMatchup): boolean {
  return a.homeTeamId === b.homeTeamId ||
         a.homeTeamId === b.awayTeamId ||
         a.awayTeamId === b.homeTeamId ||
         a.awayTeamId === b.awayTeamId;
}

/**
 * Find optimal matchups to prioritize for required-day (e.g., Saturday) scheduling.
 * Uses exhaustive search to find the maximum number of non-conflicting matchups
 * (no shared teams) that can fit within the required-day capacity.
 *
 * When costs are provided, prefers lower-cost solutions among those with the same
 * matchup count. This helps balance short rest across teams.
 *
 * This ensures we fill Saturday slots optimally before scheduling remaining games
 * on other days of the week.
 */
function findRequiredDayOptimalMatchups<T extends GameMatchup>(
  matchups: T[],
  requiredDayCapacity: number,
  costs?: number[] // Optional cost per matchup (e.g., short rest impact)
): { requiredDayMatchups: T[], otherMatchups: T[] } {
  if (requiredDayCapacity === 0 || matchups.length === 0) {
    return { requiredDayMatchups: [], otherMatchups: matchups };
  }

  // Find the maximum independent set of matchups (no shared teams)
  // Use recursive backtracking since matchup count is small (typically 6-10)
  // When costs are provided, prefer lower-cost solutions of equal size
  let bestSelection: number[] = [];
  let bestCost = Infinity;

  function backtrack(index: number, currentSelection: number[], usedTeams: Set<string>, currentCost: number): void {
    // Prune: can't possibly beat best even if we select all remaining
    if (currentSelection.length + (matchups.length - index) < bestSelection.length) {
      return;
    }

    // Update best if current is better (more matchups, or same matchups with lower cost)
    const isBetter = currentSelection.length > bestSelection.length ||
      (currentSelection.length === bestSelection.length && currentCost < bestCost);
    if (isBetter) {
      bestSelection = [...currentSelection];
      bestCost = currentCost;
    }

    // Stop if we've reached capacity
    if (currentSelection.length >= requiredDayCapacity) {
      return;
    }

    // Try each remaining matchup
    for (let i = index; i < matchups.length; i++) {
      const m = matchups[i];
      if (!usedTeams.has(m.homeTeamId) && !usedTeams.has(m.awayTeamId)) {
        // Select this matchup
        usedTeams.add(m.homeTeamId);
        usedTeams.add(m.awayTeamId);
        currentSelection.push(i);
        const matchupCost = costs ? costs[i] : 0;

        backtrack(i + 1, currentSelection, usedTeams, currentCost + matchupCost);

        // Unselect this matchup
        currentSelection.pop();
        usedTeams.delete(m.homeTeamId);
        usedTeams.delete(m.awayTeamId);
      }
    }
  }

  backtrack(0, [], new Set(), 0);

  // Convert best selection to matchup arrays
  const selectedSet = new Set(bestSelection);
  const requiredDayMatchups = matchups.filter((_, i) => selectedSet.has(i));
  const otherMatchups = matchups.filter((_, i) => !selectedSet.has(i));

  return { requiredDayMatchups, otherMatchups };
}

/**
 * Preference weight for budget allocation.
 * Higher weight = more slots allocated.
 */
export type PreferenceWeight = {
  divisionId: string;
  priority: 'required' | 'preferred' | 'acceptable';
  weight: number; // required=3, preferred=2, acceptable=1
};

/**
 * Competition group for shared-field slot balancing.
 * Represents divisions that share the same primary field for a game day.
 */
export interface CompetitionGroup {
  dayOfWeek: number;           // 0=Sunday, 6=Saturday
  divisionIds: string[];       // Divisions competing for this field on this day
  primaryFieldId: string;      // The shared primary field
  slotsPerWeek: number;        // Game slots available per week on this field for this day
  divisionPreferences: PreferenceWeight[]; // Per-division preference weights (sorted by weight desc)
}

/**
 * Tracks required-day slot budgets and usage across divisions.
 * Ensures fair distribution of Saturday (or other required day) games per week.
 */
export interface RequiredDayBudgetTracker {
  // Maps "divisionId|dayOfWeek|weekNum" -> budget (max slots allowed for that week)
  budgets: Map<string, number>;
  // Maps "divisionId|dayOfWeek|weekNum" -> usage (slots actually used that week)
  usage: Map<string, number>;
  // Competition groups (divisions sharing primary fields on required days)
  competitionGroups: CompetitionGroup[];
  // Lookup for quick "is this division in a competition group for this day?"
  divisionDayInCompetition: Set<string>; // "divisionId|dayOfWeek"
  // Number of weeks in the season (for per-week tracking)
  numWeeks: number;
}

/**
 * Find a division's primary field for a given day of week.
 * The primary field is the first field in their preference order that has availability on that day.
 */
function findPrimaryFieldForDay(
  divisionId: string,
  dayOfWeek: number,
  fieldPreferences: string[] | undefined,
  fieldAvailabilities: FieldAvailability[],
  seasonFields: SeasonField[]
): string | null {
  if (!fieldPreferences || fieldPreferences.length === 0) {
    return null;
  }

  // Build lookup: fieldId -> seasonFieldIds
  const fieldIdToSeasonFieldIds = new Map<string, string[]>();
  for (const sf of seasonFields) {
    const existing = fieldIdToSeasonFieldIds.get(sf.fieldId) || [];
    existing.push(sf.id);
    fieldIdToSeasonFieldIds.set(sf.fieldId, existing);
  }

  // Check each field in preference order
  for (const fieldId of fieldPreferences) {
    const seasonFieldIds = fieldIdToSeasonFieldIds.get(fieldId) || [];

    // Check if any season field has availability on this day
    for (const sfId of seasonFieldIds) {
      const hasAvailability = fieldAvailabilities.some(
        (fa) => fa.seasonFieldId === sfId && fa.dayOfWeek === dayOfWeek
      );
      if (hasAvailability) {
        return fieldId;
      }
    }
  }

  return null;
}

/**
 * Convert preference priority to numeric weight for budget allocation.
 */
export function getPreferenceWeight(priority: 'required' | 'preferred' | 'acceptable' | 'avoid'): number {
  switch (priority) {
    case 'required':
      return 3;
    case 'preferred':
      return 2;
    case 'acceptable':
      return 1;
    case 'avoid':
      return 0;
    default:
      return 0;
  }
}

/**
 * Build competition groups for shared-field slot balancing.
 * Groups divisions that share the same primary field for game days.
 * Includes preference weights for budget allocation (higher preference = more slots).
 * Calculates actual game capacity based on availability window duration and game duration.
 */
export function buildCompetitionGroups(
  divisions: Division[],
  divisionConfigs: Map<string, DivisionConfig>,
  fieldAvailabilities: FieldAvailability[],
  seasonFields: SeasonField[],
  gameWeeksCount: number
): CompetitionGroup[] {
  const groups: CompetitionGroup[] = [];

  // Collect all game days with preferences (required, preferred, or acceptable) across all divisions
  const allGameDays = new Set<number>();
  for (const [_divId, config] of divisionConfigs) {
    const gameDays = (config.gameDayPreferences || [])
      .filter((p) => p.priority === 'required' || p.priority === 'preferred' || p.priority === 'acceptable')
      .map((p) => p.dayOfWeek);
    for (const day of gameDays) {
      allGameDays.add(day);
    }
  }

  // For each game day, group divisions by their primary field
  for (const dayOfWeek of allGameDays) {
    // Map: primaryFieldId -> { divisionId, preference }
    const fieldToDivisions = new Map<string, PreferenceWeight[]>();

    for (const division of divisions) {
      const config = divisionConfigs.get(division.id);
      if (!config) continue;

      // Find preference for this day (if any)
      const dayPref = (config.gameDayPreferences || []).find((p) => p.dayOfWeek === dayOfWeek);
      if (!dayPref || dayPref.priority === 'avoid') {
        continue; // This division doesn't want games on this day
      }

      // Find primary field for this day
      const primaryField = findPrimaryFieldForDay(
        division.id,
        dayOfWeek,
        config.fieldPreferences,
        fieldAvailabilities,
        seasonFields
      );

      if (primaryField) {
        const existing = fieldToDivisions.get(primaryField) || [];
        existing.push({
          divisionId: division.id,
          priority: dayPref.priority as 'required' | 'preferred' | 'acceptable',
          weight: getPreferenceWeight(dayPref.priority),
        });
        fieldToDivisions.set(primaryField, existing);
      }
    }

    // Create competition groups for fields with multiple divisions
    for (const [fieldId, divisionPrefs] of fieldToDivisions) {
      if (divisionPrefs.length > 1) {
        const divisionIds = divisionPrefs.map((p) => p.divisionId);

        // Calculate game capacity for this field on this day
        // Use the average game slot duration among competing divisions
        let totalGameSlotHours = 0;
        let divisionCount = 0;
        for (const divId of divisionIds) {
          const config = divisionConfigs.get(divId);
          if (config) {
            const gameSlotHours = config.gameDurationHours + (config.gameArriveBeforeHours || 0);
            totalGameSlotHours += gameSlotHours;
            divisionCount++;
          }
        }
        const avgGameSlotHours = divisionCount > 0 ? totalGameSlotHours / divisionCount : 2; // Default 2 hours

        // Calculate total available hours per week for this field on this day
        let totalAvailableHoursPerWeek = 0;
        for (const sf of seasonFields) {
          if (sf.fieldId === fieldId) {
            const availabilities = fieldAvailabilities.filter(
              (fa) => fa.seasonFieldId === sf.id && fa.dayOfWeek === dayOfWeek
            );
            for (const avail of availabilities) {
              // Parse time strings (HH:MM format) to calculate duration
              const [startH, startM] = avail.startTime.split(':').map(Number);
              const [endH, endM] = avail.endTime.split(':').map(Number);
              const startMinutes = startH * 60 + startM;
              const endMinutes = endH * 60 + endM;
              const durationHours = (endMinutes - startMinutes) / 60;
              totalAvailableHoursPerWeek += durationHours;
            }
          }
        }

        // Calculate how many games can fit per week
        const slotsPerWeek = Math.floor(totalAvailableHoursPerWeek / avgGameSlotHours);

        // Sort by weight descending so higher preference divisions are processed first
        divisionPrefs.sort((a, b) => {
          const weightDiff = b.weight - a.weight;
          if (weightDiff !== 0) return weightDiff;
          // Deterministic tiebreaker: sort by division ID
          return a.divisionId.localeCompare(b.divisionId);
        });

        groups.push({
          dayOfWeek,
          divisionIds,
          primaryFieldId: fieldId,
          slotsPerWeek,
          divisionPreferences: divisionPrefs,
        });
      }
    }
  }

  return groups;
}

/**
 * Initialize the required-day budget tracker with competition groups and preference-weighted per-week budgets.
 */
export function initializeRequiredDayBudgetTracker(
  competitionGroups: CompetitionGroup[],
  divisionNames: Map<string, string>,
  numWeeks: number
): RequiredDayBudgetTracker {
  const tracker: RequiredDayBudgetTracker = {
    budgets: new Map(),
    usage: new Map(),
    competitionGroups,
    divisionDayInCompetition: new Set(),
    numWeeks,
  };

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const group of competitionGroups) {
    if (group.slotsPerWeek === 0) {
      continue; // No budget to allocate
    }

    // Group divisions by priority level - divisions with same priority split slots EVENLY
    const divisionsByPriority = new Map<string, string[]>();
    for (const pref of group.divisionPreferences) {
      const existing = divisionsByPriority.get(pref.priority) || [];
      existing.push(pref.divisionId);
      divisionsByPriority.set(pref.priority, existing);
    }

    // Calculate per-division budgets: split evenly among divisions with same priority
    const divisionBudgets = new Map<string, number>();
    const numDivisions = group.divisionPreferences.length;
    const basePerDivision = Math.floor(group.slotsPerWeek / numDivisions);
    let remainder = group.slotsPerWeek % numDivisions;

    // First pass: give each division an equal base allocation
    for (const pref of group.divisionPreferences) {
      divisionBudgets.set(pref.divisionId, Math.max(1, basePerDivision));
    }

    // Distribute remainder slots, rotating through priority groups to keep balance
    // This ensures divisions with same priority stay equal
    const priorityOrder = ['required', 'preferred', 'acceptable'];
    let priorityIdx = 0;
    while (remainder > 0) {
      const priority = priorityOrder[priorityIdx % priorityOrder.length];
      const divisions = divisionsByPriority.get(priority);
      if (divisions && divisions.length > 0) {
        // Give one extra slot to each division in this priority group
        for (const divId of divisions) {
          if (remainder <= 0) break;
          const current = divisionBudgets.get(divId) || 0;
          divisionBudgets.set(divId, current + 1);
          remainder--;
        }
      }
      priorityIdx++;
      // Safety: prevent infinite loop if no valid priorities
      if (priorityIdx > priorityOrder.length * 2) break;
    }

    // Log the competition group with weighted allocations
    const allocationDetails = group.divisionPreferences
      .map((p) => {
        const name = divisionNames.get(p.divisionId) || p.divisionId;
        const budget = divisionBudgets.get(p.divisionId) || 0;
        return `${name}(${p.priority})=${budget}`;
      })
      .join(', ');
    console.log(
      `[CompetitionGroup] ${dayNames[group.dayOfWeek]}: ` +
        `${group.slotsPerWeek} slots/week → ${allocationDetails}`
    );

    for (const pref of group.divisionPreferences) {
      const budgetPerWeek = divisionBudgets.get(pref.divisionId) || 0;

      // Mark this division as in competition for this day
      const dayKey = `${pref.divisionId}|${group.dayOfWeek}`;
      tracker.divisionDayInCompetition.add(dayKey);

      // Initialize per-week budgets and usage
      for (let weekNum = 0; weekNum < numWeeks; weekNum++) {
        const key = `${pref.divisionId}|${group.dayOfWeek}|${weekNum}`;
        tracker.budgets.set(key, budgetPerWeek);
        tracker.usage.set(key, 0);
      }
    }
  }

  return tracker;
}

/**
 * Check if a division can use a required-day slot for a specific week (hasn't exhausted budget).
 * Returns true if no budget restriction applies or if budget is available.
 */
export function canUseRequiredDaySlot(
  divisionId: string,
  dayOfWeek: number,
  weekNum: number,
  tracker: RequiredDayBudgetTracker
): boolean {
  const dayKey = `${divisionId}|${dayOfWeek}`;

  // If not in a competition group for this day, no restriction
  if (!tracker.divisionDayInCompetition.has(dayKey)) {
    return true;
  }

  const key = `${divisionId}|${dayOfWeek}|${weekNum}`;
  const budget = tracker.budgets.get(key) || 0;
  const used = tracker.usage.get(key) || 0;
  return used < budget;
}

/**
 * Record that a division used a required-day slot for a specific week.
 */
function recordRequiredDayUsage(
  divisionId: string,
  dayOfWeek: number,
  weekNum: number,
  tracker: RequiredDayBudgetTracker,
  divisionNames: Map<string, string>
): void {
  const dayKey = `${divisionId}|${dayOfWeek}`;

  // Only track if in a competition group
  if (!tracker.divisionDayInCompetition.has(dayKey)) {
    return;
  }

  const key = `${divisionId}|${dayOfWeek}|${weekNum}`;
  const currentUsage = tracker.usage.get(key) || 0;
  tracker.usage.set(key, currentUsage + 1);

  const budget = tracker.budgets.get(key) || 0;
  const divisionName = divisionNames.get(divisionId) || divisionId;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Log when approaching or at budget
  if (currentUsage + 1 >= budget) {
    console.log(
      `[RequiredDayBudget] ${divisionName} used ${dayNames[dayOfWeek]} slot week ${weekNum + 1} ` +
        `(${currentUsage + 1}/${budget}) - week budget exhausted`
    );
  }
}

/**
 * Redistribute unused quota from a completed division to remaining divisions.
 * For per-week budgets, this redistributes unused slots for each week.
 */
function redistributeUnusedQuota(
  completedDivisionId: string,
  remainingDivisionIds: string[],
  tracker: RequiredDayBudgetTracker,
  divisionNames: Map<string, string>
): void {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const group of tracker.competitionGroups) {
    if (!group.divisionIds.includes(completedDivisionId)) {
      continue;
    }

    // Find remaining divisions in this group
    const remainingInGroup = group.divisionIds.filter(
      (id) => id !== completedDivisionId && remainingDivisionIds.includes(id)
    );

    if (remainingInGroup.length === 0) {
      continue;
    }

    const completedName = divisionNames.get(completedDivisionId) || completedDivisionId;
    let totalRedistributed = 0;

    // Redistribute for each week
    for (let weekNum = 0; weekNum < tracker.numWeeks; weekNum++) {
      const completedKey = `${completedDivisionId}|${group.dayOfWeek}|${weekNum}`;
      const budget = tracker.budgets.get(completedKey) || 0;
      const used = tracker.usage.get(completedKey) || 0;
      const unused = budget - used;

      if (unused <= 0) {
        continue;
      }

      // Distribute unused slots evenly among remaining divisions
      const extraPerDivision = Math.floor(unused / remainingInGroup.length);
      const remainder = unused % remainingInGroup.length;

      for (let i = 0; i < remainingInGroup.length; i++) {
        const divisionId = remainingInGroup[i];
        const key = `${divisionId}|${group.dayOfWeek}|${weekNum}`;
        const currentBudget = tracker.budgets.get(key) || 0;
        // First division gets any remainder
        const extra = extraPerDivision + (i === 0 ? remainder : 0);
        tracker.budgets.set(key, currentBudget + extra);
        totalRedistributed += extra;
      }
    }

    if (totalRedistributed > 0) {
      const targetNames = remainingInGroup.map((id) => divisionNames.get(id) || id).join(', ');
      console.log(
        `[RequiredDayBudget] Redistributed ${totalRedistributed} unused ${dayNames[group.dayOfWeek]} ` +
          `slot(s) from ${completedName} to ${targetNames}`
      );
    }
  }
}

/**
 * Options for the schedule generator
 */
export interface ScheduleGeneratorOptions {
  /**
   * Skip all post-scheduling rebalancing (home/away, short rest, matchup spacing, back-to-back).
   * Defaults to false (post-processing runs).
   */
  skipPostProcessing?: boolean;
  /**
   * Skip date-swapping post-processing (keeps home/away rebalancing).
   * Defaults to true because date swaps tend to improve some metrics (e.g., short rest delta)
   * while making others worse (first game spread, games-per-week distribution, matchup spacing).
   *
   * TODO: Consider removing the date-swap functions entirely (reduceBackToBackGames,
   * rebalanceMatchupSpacing, rebalanceShortRest) since they cause more problems than they solve.
   */
  skipDateSwaps?: boolean;
}

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

  // Generator options
  private options: ScheduleGeneratorOptions;

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
    cageOverrides: CageDateOverride[],
    options: ScheduleGeneratorOptions = {}
  ) {
    this.options = {
      skipPostProcessing: false,
      skipDateSwaps: true,
      ...options,
    };
    this.season = season;
    this.divisions = divisions; // Already sorted by schedulingOrder from listDivisions
    this.divisionConfigs = new Map(divisionConfigs.map((dc) => [dc.divisionId, dc]));
    this.divisionNames = new Map(divisions.map((d) => [d.id, d.name]));
    // Sort all input arrays by ID for deterministic ordering regardless of input order
    this.teams = [...teams].sort((a, b) => a.id.localeCompare(b.id));
    this.seasonFields = [...seasonFields].sort((a, b) => a.id.localeCompare(b.id));
    this.seasonCages = [...seasonCages].sort((a, b) => a.id.localeCompare(b.id));
    this.fieldAvailability = [...fieldAvailability].sort((a, b) => a.id.localeCompare(b.id));
    this.cageAvailability = [...cageAvailability].sort((a, b) => a.id.localeCompare(b.id));
    this.fieldOverrides = [...fieldOverrides].sort((a, b) => a.id.localeCompare(b.id));
    this.cageOverrides = [...cageOverrides].sort((a, b) => a.id.localeCompare(b.id));

    // Build lookup maps (using sorted arrays for deterministic iteration)
    for (const sf of this.seasonFields) {
      this.seasonFieldToFieldId.set(sf.id, sf.fieldId);
      // Store division compatibility (from the joined Field data)
      this.fieldDivisionCompatibility.set(sf.fieldId, sf.divisionCompatibility || []);
    }
    for (const sc of this.seasonCages) {
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
    // Sort by ID for deterministic ordering regardless of input order
    this.existingEventsToProcess = [...existingEvents].sort((a, b) => a.id.localeCompare(b.id));
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
   * Simple hash function for fingerprinting inputs (for determinism verification)
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
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
   * Check if a specific week has an explicit override (vs using the default gamesPerWeek)
   */
  private hasGameWeekOverride(divisionId: string, weekNumber: number): boolean {
    const config = this.divisionConfigs.get(divisionId);
    if (!config) return false;
    return config.gameWeekOverrides?.some(o => o.weekNumber === weekNumber) ?? false;
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

      // === INPUT FINGERPRINT FOR DETERMINISM VERIFICATION ===
      console.log('\n=== INPUT FINGERPRINT ===');
      console.log(`Season: ${this.season.id} | ${this.season.startDate} - ${this.season.endDate} | gamesStart: ${this.season.gamesStartDate}`);
      console.log(`Blackouts: ${JSON.stringify(this.season.blackoutDates?.slice(0, 3))}${(this.season.blackoutDates?.length || 0) > 3 ? '...' : ''} (${this.season.blackoutDates?.length || 0} total)`);

      // Log divisions in scheduling order
      console.log(`Divisions (${this.divisions.length}): ${this.divisions.map(d => `${d.name}[${d.id.slice(-8)}]`).join(', ')}`);

      // Log teams per division (in actual internal order after constructor sorting)
      const allTeamIds: string[] = [];
      for (const division of this.divisions) {
        const divTeams = this.teams.filter(t => t.divisionId === division.id);
        console.log(`  ${division.name} teams (${divTeams.length}): ${divTeams.map(t => `${t.name}[${t.id.slice(-8)}]`).join(', ')}`);
        allTeamIds.push(...divTeams.map(t => t.id));
      }
      console.log(`  teams order hash=${this.simpleHash(allTeamIds.join('|'))}`);

      // Log division configs
      for (const division of this.divisions) {
        const config = this.divisionConfigs.get(division.id);
        if (config) {
          console.log(`  ${division.name} config: g/w=${config.gamesPerWeek}, p/w=${config.practicesPerWeek}, spacing=${config.gameSpacingEnabled}, maxGames=${config.maxGamesPerSeason || 'none'}`);
        }
      }

      // Log field availability details (sorted for comparison)
      const fieldAvailDetails = this.fieldAvailability
        .map((fa: { seasonFieldId: string; dayOfWeek: number; startTime: string; endTime: string }) =>
          `${fa.seasonFieldId.slice(-8)}:d${fa.dayOfWeek}:${fa.startTime}-${fa.endTime}`)
        .sort();
      console.log(`Field availabilities (${this.fieldAvailability.length}):`);
      console.log(`  ${fieldAvailDetails.slice(0, 10).join(', ')}${fieldAvailDetails.length > 10 ? '...' : ''}`);
      console.log(`  hash=${this.simpleHash(fieldAvailDetails.join('|'))}`);

      // Log existing events details
      console.log(`Existing events to process: ${this.existingEventsToProcess.length}`);
      if (this.existingEventsToProcess.length > 0) {
        const existingDetails = this.existingEventsToProcess
          .map(e => `${e.date}:${e.startTime}:${e.fieldId?.slice(-8) || 'none'}:${e.divisionId?.slice(-8) || 'none'}`)
          .sort();
        console.log(`  ${existingDetails.slice(0, 5).join(', ')}${existingDetails.length > 5 ? '...' : ''}`);
        console.log(`  hash=${this.simpleHash(existingDetails.join('|'))}`);
      }

      // Log cage availability with hash
      const cageAvailDetails = this.cageAvailability
        .map((ca: { seasonCageId: string; dayOfWeek: number; startTime: string; endTime: string }) =>
          `${ca.seasonCageId.slice(-8)}:d${ca.dayOfWeek}:${ca.startTime}-${ca.endTime}`)
        .sort();
      console.log(`Cage availabilities: ${this.cageAvailability.length}, hash=${this.simpleHash(cageAvailDetails.join('|'))}`);

      // Log field overrides with hash
      const fieldOverrideDetails = this.fieldOverrides
        .map((fo: { seasonFieldId: string; date: string; overrideType: string }) =>
          `${fo.date}:${fo.seasonFieldId.slice(-8)}:${fo.overrideType}`)
        .sort();
      console.log(`Field overrides: ${this.fieldOverrides.length}, hash=${this.simpleHash(fieldOverrideDetails.join('|'))}`);
      if (this.fieldOverrides.length > 0) {
        console.log(`  ${fieldOverrideDetails.slice(0, 5).join(', ')}${fieldOverrideDetails.length > 5 ? '...' : ''}`);
      }

      // Log cage overrides with hash
      const cageOverrideDetails = this.cageOverrides
        .map((co: { seasonCageId: string; date: string; overrideType: string }) =>
          `${co.date}:${co.seasonCageId.slice(-8)}:${co.overrideType}`)
        .sort();
      console.log(`Cage overrides: ${this.cageOverrides.length}, hash=${this.simpleHash(cageOverrideDetails.join('|'))}`);

      // Log season fields with hash
      const seasonFieldDetails = this.seasonFields
        .map((sf: { id: string; fieldId: string }) => `${sf.id.slice(-8)}:${sf.fieldId.slice(-8)}`)
        .sort();
      console.log(`Season fields: ${this.seasonFields.length}, hash=${this.simpleHash(seasonFieldDetails.join('|'))}`);

      // Log season cages with hash
      const seasonCageDetails = this.seasonCages
        .map((sc: { id: string; cageId: string }) => `${sc.id.slice(-8)}:${sc.cageId.slice(-8)}`)
        .sort();
      console.log(`Season cages: ${this.seasonCages.length}, hash=${this.simpleHash(seasonCageDetails.join('|'))}`);

      // Log division configs with hash
      const divConfigDetails = Array.from(this.divisionConfigs.entries())
        .map(([divId, config]) => `${divId.slice(-8)}:g${config.gamesPerWeek}:p${config.practicesPerWeek}`)
        .sort();
      console.log(`Division configs: ${this.divisionConfigs.size}, hash=${this.simpleHash(divConfigDetails.join('|'))}`);

      // Log divisions order hash
      const divisionOrderDetails = this.divisions.map(d => d.id).join('|');
      console.log(`Divisions order hash=${this.simpleHash(divisionOrderDetails)}`);

      console.log('=== END INPUT FINGERPRINT ===\n');

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

      // Post-processing: rebalancing steps to improve schedule quality
      // These can be skipped for testing/comparison purposes
      if (!this.options.skipPostProcessing) {
        // Step 4b: Rebalance home/away for scheduled games
        // This fixes imbalances caused by games that failed to schedule
        // NOTE: This only swaps home/away designations, not game dates/times
        stepStart = Date.now();
        this.rebalanceScheduledHomeAway();
        console.log(`  rebalanceHomeAway: ${Date.now() - stepStart}ms`);

        // The following steps swap game dates and can be skipped separately
        if (!this.options.skipDateSwaps) {
          // Step 4c: Reduce back-to-back games (1-day gaps)
          // This tries to eliminate 1-day gaps between games for all divisions
          stepStart = Date.now();
          const scheduledGames = this.scheduledEvents.filter(e => e.eventType === 'game');
          this.reduceBackToBackGames(scheduledGames);
          console.log(`  reduceBackToBackGames: ${Date.now() - stepStart}ms`);

          // Step 4d: Rebalance matchup spacing (avoid same teams playing within 7 days)
          stepStart = Date.now();
          this.rebalanceMatchupSpacing();
          console.log(`  rebalanceMatchupSpacing: ${Date.now() - stepStart}ms`);

          // Step 4e: Rebalance short rest violations across teams (run LAST)
          // This swaps game dates to balance short rest violations
          // Running last ensures the final schedule has balanced short rest delta
          stepStart = Date.now();
          this.rebalanceShortRest();
          console.log(`  rebalanceShortRest: ${Date.now() - stepStart}ms`);
        } else {
          console.log('  [SKIPPED] Date-swapping post-processing (default behavior)');
        }
      } else {
        console.log('  [SKIPPED] All post-processing disabled');
      }

      // Rebuild fieldDatesUsed from actual scheduled events after rebalancing
      // This is necessary because rebalancing swaps dates directly on events
      // without updating the team scheduling states
      this.rebuildFieldDatesUsed();

      // Rebuild event indexes after rebalancing
      // This ensures practices/cages can detect conflicts with swapped games
      if (this.scoringContext) {
        rebuildEventIndexes(this.scoringContext, this.scheduledEvents);
      }

      // Build warmup blocks from scheduled games - needed before any cage scheduling
      // (including Sunday paired practices which may include cage time)
      this.buildGameWarmupBlocks();

      // Step 4e: Schedule Sunday combo practices (before regular practices)
      verboseLog('\n' + '-'.repeat(80));
      verboseLog('SCHEDULING SUNDAY COMBO PRACTICES');
      verboseLog('-'.repeat(80));
      stepStart = Date.now();
      const eventsBeforeCombo = this.scheduledEvents.length;
      await this.scheduleSundayPairedPractices();
      console.log(`  scheduleSundayPairedPractices: ${Date.now() - stepStart}ms`);
      const comboEventsScheduled = this.scheduledEvents.length - eventsBeforeCombo;
      verboseLog(`✓ Sunday combo events scheduled: ${comboEventsScheduled}`);

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

    // Build a map of date -> blocked event types for season-level blackouts that apply to ALL divisions.
    // Division-specific blackouts are checked separately via isDateBlockedForDivision().
    // If blockedEventTypes is not set, all types are blocked for that date.
    const globalBlackoutsByDate = new Map<string, Set<'game' | 'practice' | 'cage'>>();
    let divisionSpecificBlackoutCount = 0;

    for (const blackout of this.season.blackoutDates || []) {
      // Only include in global map if this blackout applies to ALL divisions
      const appliesToAllDivisions = !blackout.divisionIds || blackout.divisionIds.length === 0;

      if (!appliesToAllDivisions) {
        divisionSpecificBlackoutCount++;
        continue; // Division-specific blackouts are handled by isDateBlockedForDivision()
      }

      const dates = blackout.endDate
        ? getDateRange(blackout.date, blackout.endDate)
        : [blackout.date];

      // If no blockedEventTypes specified, block all types
      const blockedTypes = blackout.blockedEventTypes && blackout.blockedEventTypes.length > 0
        ? blackout.blockedEventTypes
        : ['game', 'practice', 'cage'] as const;

      for (const d of dates) {
        if (!globalBlackoutsByDate.has(d)) {
          globalBlackoutsByDate.set(d, new Set());
        }
        for (const eventType of blockedTypes) {
          globalBlackoutsByDate.get(d)!.add(eventType);
        }
      }
    }

    // Helper to check if a date is globally blocked for a specific event type (all divisions)
    const isDateGloballyBlockedForEventType = (date: string, eventType: 'game' | 'practice' | 'cage'): boolean => {
      const blockedTypes = globalBlackoutsByDate.get(date);
      return blockedTypes !== undefined && blockedTypes.has(eventType);
    };

    if (globalBlackoutsByDate.size > 0 || divisionSpecificBlackoutCount > 0) {
      // Count dates fully blocked (all event types) for all divisions
      const fullyBlockedDates = Array.from(globalBlackoutsByDate.entries())
        .filter(([_, types]) => types.size === 3)
        .map(([date]) => date);
      const partiallyBlockedDates = Array.from(globalBlackoutsByDate.entries())
        .filter(([_, types]) => types.size < 3)
        .map(([date, types]) => `${date} (${Array.from(types).join(', ')})`);

      this.log('info', 'general', `Season blackouts: ${fullyBlockedDates.length} fully blocked dates, ${partiallyBlockedDates.length} partially blocked dates, ${divisionSpecificBlackoutCount} division-specific blackouts`, {
        fullyBlockedDates: fullyBlockedDates.sort(),
        partiallyBlockedDates: partiallyBlockedDates.sort(),
      });
    }

    // Build game field slots for dates from gamesStartDate onwards
    // Exclude practice-only fields for games
    // Filter out dates where games are globally blocked (all divisions)
    // Division-specific blackouts are checked when scheduling each division
    const gameDates = allDatesRaw.filter(date =>
      this.isGameDateAllowed(date) && !isDateGloballyBlockedForEventType(date, 'game')
    );
    this.buildFieldSlotsForDates(gameDates, this.gameFieldSlots, true);

    // Build practice field slots for all season dates
    // Include all fields (both game-capable and practice-only)
    // Filter out dates where practices are globally blocked (all divisions)
    const practiceDates = allDatesRaw.filter(date =>
      this.isPracticeDateAllowed(date) && !isDateGloballyBlockedForEventType(date, 'practice')
    );
    this.buildFieldSlotsForDates(practiceDates, this.practiceFieldSlots, false);

    // Build cage slots for all season dates
    // Filter out dates where cages are globally blocked (all divisions)
    const cageDates = allDatesRaw.filter(date =>
      this.isPracticeDateAllowed(date) && !isDateGloballyBlockedForEventType(date, 'cage')
    );
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

    // Log hash of game field slots for determinism debugging
    const gameSlotDetails = this.gameFieldSlots
      .map(s => `${s.slot.date}:${s.slot.startTime}:${s.resourceId.slice(-8)}`)
      .sort();
    console.log(`Game field slots: ${this.gameFieldSlots.length}, hash=${this.simpleHash(gameSlotDetails.join('|'))}`);

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
   * Apply a blackout override to a time window and return remaining usable windows.
   * If blackout has no times, returns empty array (full day blocked).
   * If blackout has times, returns the portions of the window not covered by the blackout.
   */
  private applyBlackoutToTimeWindow(
    windowStart: string,
    windowEnd: string,
    blackoutStart: string | undefined,
    blackoutEnd: string | undefined
  ): Array<{ startTime: string; endTime: string }> {
    // If blackout has no times, it blocks the entire day
    if (!blackoutStart || !blackoutEnd) {
      return [];
    }

    const windowStartMins = timeToMinutes(windowStart);
    const windowEndMins = timeToMinutes(windowEnd);
    const blackoutStartMins = timeToMinutes(blackoutStart);
    const blackoutEndMins = timeToMinutes(blackoutEnd);

    // If blackout doesn't overlap with window, return full window
    if (blackoutEndMins <= windowStartMins || blackoutStartMins >= windowEndMins) {
      return [{ startTime: windowStart, endTime: windowEnd }];
    }

    const result: Array<{ startTime: string; endTime: string }> = [];

    // Time before the blackout
    if (blackoutStartMins > windowStartMins) {
      result.push({
        startTime: windowStart,
        endTime: minutesToTime(Math.min(blackoutStartMins, windowEndMins)),
      });
    }

    // Time after the blackout
    if (blackoutEndMins < windowEndMins) {
      result.push({
        startTime: minutesToTime(Math.max(blackoutEndMins, windowStartMins)),
        endTime: windowEnd,
      });
    }

    return result;
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

        // Check for "added" overrides on this date (adds availability on days without regular availability)
        const addedOverride = this.fieldOverrides.find(
          (o) => o.seasonFieldId === seasonField.id && o.date === date && o.overrideType === 'added'
        );

        // If there's no regular availability but there's an "added" override, use the override
        if (availability.length === 0 && addedOverride && addedOverride.startTime && addedOverride.endTime) {
          const duration = calculateDuration(addedOverride.startTime, addedOverride.endTime);
          targetSlots.push({
            resourceType: 'field',
            resourceId: seasonField.fieldId,
            resourceName: seasonField.field?.name || seasonField.fieldId,
            slot: {
              date,
              dayOfWeek,
              startTime: addedOverride.startTime,
              endTime: addedOverride.endTime,
              duration,
            },
            singleEventOnly: addedOverride.singleEventOnly,
          });
          continue;
        }

        for (const avail of availability) {
          const override = this.fieldOverrides.find(
            (o) => o.seasonFieldId === seasonField.id && o.date === date
          );

          // Handle blackout overrides - may block entire day or just a time window
          if (override?.overrideType === 'blackout') {
            const remainingWindows = this.applyBlackoutToTimeWindow(
              avail.startTime,
              avail.endTime,
              override.startTime,
              override.endTime
            );

            // Create slots for any remaining time windows after applying blackout
            for (const window of remainingWindows) {
              const duration = calculateDuration(window.startTime, window.endTime);
              targetSlots.push({
                resourceType: 'field',
                resourceId: seasonField.fieldId,
                resourceName: seasonField.field?.name || seasonField.fieldId,
                slot: {
                  date,
                  dayOfWeek,
                  startTime: window.startTime,
                  endTime: window.endTime,
                  duration,
                },
                singleEventOnly: avail.singleEventOnly,
              });
            }
            continue;
          }

          // Handle 'added' overrides or no override - use override times if available
          const startTime = override?.startTime || avail.startTime;
          const endTime = override?.endTime || avail.endTime;
          const duration = calculateDuration(startTime, endTime);
          // Use override's singleEventOnly if set, otherwise use availability's
          const singleEventOnly = override?.singleEventOnly || avail.singleEventOnly;

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
            singleEventOnly,
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

        // Check for "added" overrides on this date (adds availability on days without regular availability)
        const addedOverride = this.cageOverrides.find(
          (o) => o.seasonCageId === seasonCage.id && o.date === date && o.overrideType === 'added'
        );

        // If there's no regular availability but there's an "added" override, use the override
        if (availability.length === 0 && addedOverride && addedOverride.startTime && addedOverride.endTime) {
          const duration = calculateDuration(addedOverride.startTime, addedOverride.endTime);
          this.cageSlots.push({
            resourceType: 'cage',
            resourceId: seasonCage.cageId,
            resourceName: seasonCage.cage?.name || seasonCage.cageId,
            slot: {
              date,
              dayOfWeek,
              startTime: addedOverride.startTime,
              endTime: addedOverride.endTime,
              duration,
            },
            singleEventOnly: addedOverride.singleEventOnly,
          });
          continue;
        }

        for (const avail of availability) {
          const override = this.cageOverrides.find(
            (o) => o.seasonCageId === seasonCage.id && o.date === date
          );

          // Handle blackout overrides - may block entire day or just a time window
          if (override?.overrideType === 'blackout') {
            const remainingWindows = this.applyBlackoutToTimeWindow(
              avail.startTime,
              avail.endTime,
              override.startTime,
              override.endTime
            );

            // Create slots for any remaining time windows after applying blackout
            for (const window of remainingWindows) {
              const duration = calculateDuration(window.startTime, window.endTime);
              this.cageSlots.push({
                resourceType: 'cage',
                resourceId: seasonCage.cageId,
                resourceName: seasonCage.cage?.name || seasonCage.cageId,
                slot: {
                  date,
                  dayOfWeek,
                  startTime: window.startTime,
                  endTime: window.endTime,
                  duration,
                },
                singleEventOnly: avail.singleEventOnly,
              });
            }
            continue;
          }

          // Handle 'added' overrides or no override - use override times if available
          const startTime = override?.startTime || avail.startTime;
          const endTime = override?.endTime || avail.endTime;
          const duration = calculateDuration(startTime, endTime);

          // Use override's singleEventOnly if set, otherwise use availability's
          const singleEventOnly = override?.singleEventOnly ?? avail.singleEventOnly;

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
            singleEventOnly,
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
        // Only apply min day gap when game spacing is enabled for this division
        // Default to 2 days minimum gap when game spacing is enabled (eliminates back-to-back day games)
        minDaysBetweenEvents: config.gameSpacingEnabled ? (config.minConsecutiveDayGap || 2) : 0,
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

      // Set up division-level weekday practice start time overrides
      if (config.weekdayPracticeStartTime) {
        if (!this.scoringContext.divisionWeekdayPracticeStartTimes) {
          this.scoringContext.divisionWeekdayPracticeStartTimes = new Map();
        }
        this.scoringContext.divisionWeekdayPracticeStartTimes.set(divisionId, config.weekdayPracticeStartTime);
      }
    }

    // Set up season-level weekday practice start time
    if (this.season.weekdayPracticeStartTime) {
      this.scoringContext.seasonWeekdayPracticeStartTime = this.season.weekdayPracticeStartTime;
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
      config: { gamesPerWeek: number; gameDurationHours: number; gameArriveBeforeHours?: number; maxGamesPerWeek?: number };
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
      // Each round-robin round has every team playing exactly once.
      // With per-week overrides, we need variable rounds per week.
      const matchupsPerRound = numTeams / 2; // For even teams
      const totalRoundsNeeded = totalGamesPerTeam; // Total rounds = total games per team

      verboseLog(`  Matchups per round: ${matchupsPerRound}`);
      verboseLog(`  Total rounds needed: ${totalRoundsNeeded}`);

      // Generate exactly the rounds we need - home/away is balanced internally
      const teamIds = divisionTeams.map(t => t.id);
      const rounds = generateRoundRobinMatchups(teamIds, minCycles, totalRoundsNeeded);

      verboseLog(`  Rounds generated: ${rounds.length}`);

      if (rounds.length < totalRoundsNeeded) {
        console.warn(`  ⚠️ Not enough rounds: have ${rounds.length}, need ${totalRoundsNeeded}`);
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
        for (let r = 0; r < gamesThisWeek && roundIndex < rounds.length; r++) {
          const round = rounds[roundIndex++];
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

      // Log pre-scheduling matchup counts per team (for debugging game balance)
      const preMatchupCounts = new Map<string, number>();
      for (const team of divisionTeams) {
        const count = matchups.filter(m => m.homeTeamId === team.id || m.awayTeamId === team.id).length;
        preMatchupCounts.set(team.name, count);
      }
      const matchupCountSummary = Array.from(preMatchupCounts.entries()).map(([name, count]) => `${name}:${count}`).join(', ');
      console.log(`  [PreMatchups] ${divisionName}: ${matchups.length} matchups, per-team: ${matchupCountSummary}`);

      // Rebalance home/away for matchups to ensure all teams have balanced assignments
      const rebalanceResult = rebalanceMatchupsHomeAway(matchups, teamIds);
      verboseLog(`  Rebalancing: ${rebalanceResult.phase1Swaps} Phase 1 swaps, ${rebalanceResult.phase2Swaps} Phase 2 swaps`);

      // Log matchups hash for determinism debugging
      const matchupDetails = matchups
        .map(m => `${m.targetWeek}:${[m.homeTeamId, m.awayTeamId].sort().join('-')}`)
        .sort();
      console.log(`  [MatchupsHash] ${divisionName}: ${matchups.length} matchups, hash=${this.simpleHash(matchupDetails.join('|'))}`);

      // Log the distribution
      const weekCounts = new Map<number, number>();
      for (const m of matchups) {
        weekCounts.set(m.targetWeek, (weekCounts.get(m.targetWeek) || 0) + 1);
      }
      // Debug: Show matchup distribution for Majors
      const weekCountsArr = Array.from(weekCounts.entries()).sort((a, b) => a[0] - b[0]);
      const weekCountsStr = weekCountsArr.map(([w, c]) => `w${w + 1}:${c}`).join(', ');
      console.log(`  [MatchupDist] ${divisionName}: ${weekCountsStr}`);
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

      // Log pre-scheduling home/away balance in verbose mode
      verboseLog(`  [PreSchedule] ${divisionName} home/away balance after rebalancing:`);
      for (const [name, counts] of Object.entries(preScheduleHomeAway)) {
        const diff = Math.abs(counts.home - counts.away);
        const status = diff <= 1 ? '✓' : '⚠';
        verboseLog(`    ${name}: ${counts.home}H/${counts.away}A (diff: ${diff}) ${status}`);
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
        roundsUsed: rounds.length,
        totalMatchups: matchups.length,
        totalMatchupsNeeded,
        weekDistribution,
        preScheduleHomeAway,
      }, distributionSummary);

      divisionMatchupsList.push({
        divisionId,
        divisionName,
        teams: divisionTeams,
        config: { gamesPerWeek: config.gamesPerWeek, gameDurationHours: config.gameDurationHours, gameArriveBeforeHours: config.gameArriveBeforeHours, maxGamesPerWeek: config.maxGamesPerWeek },
        matchups,
      });
    }

    // Phase 2: Schedule each matchup to a time slot
    // Process matchups in order (by target week), finding the best available slot
    // Prioritize keeping rematches spread out by preferring slots in the target week

    // Build required-day budget tracker for fair slot distribution between competing divisions
    const competitionGroups = buildCompetitionGroups(
      this.divisions,
      this.divisionConfigs,
      this.fieldAvailability,
      this.seasonFields,
      gameWeeks.length
    );
    const requiredDayBudgetTracker = initializeRequiredDayBudgetTracker(
      competitionGroups,
      this.divisionNames,
      gameWeeks.length
    );

    // Pre-pass: Schedule competition group games in interleaved fashion
    // This ensures divisions sharing a primary field get alternating time slots
    const scheduledInPrePass = this.scheduleCompetitionGroupGamesInterleaved(
      competitionGroups,
      requiredDayBudgetTracker,
      divisionMatchupsList,
      gameWeeks
    );

    let totalScheduled = scheduledInPrePass.size;
    let failedToSchedule = 0;

    for (let divisionIndex = 0; divisionIndex < divisionMatchupsList.length; divisionIndex++) {
      const division = divisionMatchupsList[divisionIndex];
      verboseLog(`\nScheduling ${division.divisionName}:`);

      // Calculate total game slot time (game duration + arrive before time)
      const totalGameSlotHours = division.config.gameDurationHours + (division.config.gameArriveBeforeHours || 0);

      // Build team lookup map for O(1) access
      const teamLookup = new Map(division.teams.map(t => [t.id, t]));

      // Track preferred day games per team (e.g., Saturday games)
      // Used to balance preferred day distribution
      // NOTE: Will be initialized with counts from pre-pass games after requiredDays is defined
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
          this.isFieldCompatibleWithDivision(rs.resourceId, division.divisionId) &&
          !this.isDateBlockedForDivision(rs.slot.date, 'game', division.divisionId)
        );
        fieldSlotsByWeek.set(i, weekSlots);
      }

      // Debug: Log slots per week for this division
      const weekSlotInfo: string[] = [];
      const emptyWeeks: number[] = [];
      for (let i = 0; i < gameWeeks.length; i++) {
        const slots = fieldSlotsByWeek.get(i) || [];
        const uniqueDates = new Set(slots.map(s => s.slot.date));
        weekSlotInfo.push(`w${i + 1}:${uniqueDates.size}d`);
        if (slots.length === 0) {
          emptyWeeks.push(i + 1); // 1-indexed for display
        }
        // Debug week 1 and 11 for Majors specifically
        if (division.divisionName === 'Majors' && (i === 0 || i === 10)) {
          const week = gameWeeks[i];
          const weekDatesArr = week.dates;
          const availableDatesArr = [...uniqueDates].sort();
          const missingDates = weekDatesArr.filter(d => !uniqueDates.has(d));
          console.log(`  [Debug] Majors week 11 (${week.startDate} to ${week.endDate}): ${weekDatesArr.length} week dates, ${availableDatesArr.length} available`);
          console.log(`    Week dates: ${weekDatesArr.join(', ')}`);
          console.log(`    Available: ${availableDatesArr.join(', ')}`);
          console.log(`    Missing: ${missingDates.length > 0 ? missingDates.join(', ') : 'none'}`);
          // Show slots per available date
          for (const date of availableDatesArr) {
            const slotsForDate = slots.filter(s => s.slot.date === date);
            console.log(`      ${date}: ${slotsForDate.length} slots`);
          }
          // Debug Saturday specifically
          const satDate = weekDatesArr.find(d => getDayOfWeek(d) === 6) || '';
          if (satDate) {
            const allSatSlots = this.gameFieldSlots.filter(rs => rs.slot.date === satDate);
            const compatSatSlots = allSatSlots.filter(rs => this.isFieldCompatibleWithDivision(rs.resourceId, division.divisionId));
            console.log(`    Saturday ${satDate} breakdown: ${allSatSlots.length} total, ${compatSatSlots.length} compatible`);
            for (const slot of allSatSlots) {
              const isCompat = this.isFieldCompatibleWithDivision(slot.resourceId, division.divisionId);
              console.log(`      ${slot.resourceName}: ${slot.slot.startTime}-${slot.slot.endTime}, compatible=${isCompat}`);
            }
          }
          // Check why each missing date is missing
          for (const date of missingDates) {
            const allSlotsForDate = this.gameFieldSlots.filter(rs => rs.slot.date === date);
            const compatibleSlots = allSlotsForDate.filter(rs => this.isFieldCompatibleWithDivision(rs.resourceId, division.divisionId));
            const notBlockedSlots = compatibleSlots.filter(rs => !this.isDateBlockedForDivision(rs.slot.date, 'game', division.divisionId));
            const isBlocked = this.isDateBlockedForDivision(date, 'game', division.divisionId);
            console.log(`      ${date}: total=${allSlotsForDate.length}, compatible=${compatibleSlots.length}, notBlocked=${notBlockedSlots.length}, isBlocked=${isBlocked}`);
          }
        }
      }
      console.log(`  [FieldSlots] ${division.divisionName}: dates per week: ${weekSlotInfo.join(', ')}`);
      if (emptyWeeks.length > 0) {
        console.log(`  [FieldSlots] ${division.divisionName}: weeks with no compatible field slots: ${emptyWeeks.join(', ')}`);
      }

      // Log available game slots for this division (sanity check)
      const allDivisionSlots = this.gameFieldSlots.filter(rs =>
        this.isFieldCompatibleWithDivision(rs.resourceId, division.divisionId) &&
        !this.isDateBlockedForDivision(rs.slot.date, 'game', division.divisionId)
      );
      const slotsByDayOfWeek = new Map<number, number>();
      for (const slot of allDivisionSlots) {
        const count = slotsByDayOfWeek.get(slot.slot.dayOfWeek) || 0;
        slotsByDayOfWeek.set(slot.slot.dayOfWeek, count + 1);
      }
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const slotBreakdown: Record<string, number> = {};
      for (const [day, count] of slotsByDayOfWeek.entries()) {
        slotBreakdown[dayNames[day]] = count;
      }
      const slotSummary = Object.entries(slotBreakdown).map(([day, count]) => `${day}: ${count}`).join(', ');
      verboseLog(`  Game slots for ${division.divisionName}: ${allDivisionSlots.length} total, ${division.matchups.length} games needed (${slotSummary})`);

      // Build detailed slot list grouped by date
      const slotsByDate = new Map<string, Array<{ field: string; time: string }>>();
      for (const slot of allDivisionSlots) {
        const dateSlots = slotsByDate.get(slot.slot.date) || [];
        dateSlots.push({
          field: slot.resourceName,
          time: `${slot.slot.startTime}-${slot.slot.endTime}`,
        });
        slotsByDate.set(slot.slot.date, dateSlots);
      }
      // Format as array sorted by date
      const detailedSlots = Array.from(slotsByDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, slots]) => {
          const dayName = dayNames[getDayOfWeek(date)].substring(0, 3);
          const slotList = slots.map(s => `${s.field} ${s.time}`).join(', ');
          return `${date} (${dayName}): ${slotList}`;
        });
      verboseLog(`    Available slots by date:`);
      for (const line of detailedSlots) {
        verboseLog(`      ${line}`);
      }

      this.log('info', 'game', `Game slot availability for ${division.divisionName}`, {
        divisionId: division.divisionId,
        totalGameSlots: allDivisionSlots.length,
        gamesNeeded: division.matchups.length,
        slotsByDayOfWeek: slotBreakdown,
        detailedSlots,
      }, `${division.divisionName}: ${allDivisionSlots.length} game slots available, ${division.matchups.length} games to schedule`);

      // Get the required AND preferred days for this division (high priority days to optimize for)
      const gameDayPrefs = this.scoringContext?.gameDayPreferences.get(division.divisionId) || [];
      // Truly required days (must be prioritized over preferred)
      const strictlyRequiredDays = gameDayPrefs
        .filter(p => p.priority === 'required')
        .map(p => p.dayOfWeek);
      // Preferred days (second priority after required)
      const preferredDays = gameDayPrefs
        .filter(p => p.priority === 'preferred')
        .map(p => p.dayOfWeek);
      // Combined for backward compatibility with budget tracking
      const requiredDays = [...strictlyRequiredDays, ...preferredDays];

      // Initialize preferredDayGames with counts from games already scheduled (e.g., from interleaved pre-pass)
      // This ensures the main loop fairness check accounts for games scheduled in the pre-pass
      if (requiredDays.length > 0) {
        for (const team of division.teams) {
          let priorityDayGamesCount = 0;
          for (const event of this.scheduledEvents) {
            if (event.eventType === 'game' &&
                (event.homeTeamId === team.id || event.awayTeamId === team.id)) {
              const eventDayOfWeek = parseLocalDate(event.date).getDay();
              if (requiredDays.includes(eventDayOfWeek)) {
                priorityDayGamesCount++;
              }
            }
          }
          preferredDayGames.set(team.id, priorityDayGamesCount);
        }
        // Log initial priority day game counts from pre-pass
        const counts = Array.from(preferredDayGames.entries()).map(([id, count]) => {
          const team = division.teams.find(t => t.id === id);
          return `${team?.name || id}:${count}`;
        }).join(', ');
        console.log(`[FAIRNESS-INIT] ${division.divisionName} initial priority day (required+preferred) counts from pre-pass: ${counts}`);
      }

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

      // Track matchups that couldn't be scheduled in their target week (spillover)
      // These will be attempted in subsequent weeks
      let spilloverMatchups: Array<GameMatchup & { targetWeek: number; originalWeek: number }> = [];

      // Process ALL weeks in order (not just weeks with assigned matchups)
      // This ensures spillover matchups can be scheduled in any future week
      for (let weekNum = 0; weekNum < gameWeeks.length; weekNum++) {
        const weekMatchups = matchupsByWeek.get(weekNum) || [];
        const weekFieldSlots = fieldSlotsByWeek.get(weekNum) || [];

        // Combine spillover matchups with this week's matchups
        // Spillover gets priority since they're already delayed
        const allMatchupsThisWeek: Array<GameMatchup & { targetWeek: number; originalWeek?: number }> = [
          ...spilloverMatchups.map(m => ({ ...m })),
          ...weekMatchups.map(m => ({ ...m, originalWeek: m.targetWeek })),
        ];

        // Clear spillover - we'll re-add any that fail this week
        const newSpillover: Array<GameMatchup & { targetWeek: number; originalWeek: number }> = [];
        spilloverMatchups = [];

        // Count how many games can fit on required days this week
        // A single slot (e.g., 9am-6pm) can hold multiple games
        let requiredDayGameCapacity = 0;
        if (requiredDays.length > 0) {
          for (const slot of weekFieldSlots) {
            if (requiredDays.includes(slot.slot.dayOfWeek)) {
              // Calculate how many games of this division's duration can fit in this slot
              const gamesInSlot = Math.floor(slot.slot.duration / totalGameSlotHours);
              requiredDayGameCapacity += gamesInSlot;
            }
          }
        }

        // Skip weeks with no matchups to process
        if (allMatchupsThisWeek.length === 0) {
          continue;
        }

        // Determine if there's scarcity: fewer required-day game slots than matchups
        const hasRequiredDayScarcity = requiredDays.length > 0 && requiredDayGameCapacity < allMatchupsThisWeek.length;
        if (hasRequiredDayScarcity) {
          verboseLog(`  Week ${weekNum + 1}: Required-day scarcity - ${requiredDayGameCapacity} game slots for ${allMatchupsThisWeek.length} matchups`);
        }

        // Reorder matchups to maximize required-day (Saturday) slot utilization
        // Matchups that can fill required-day slots without team conflicts go first
        // This ensures we fill Saturday before scheduling remaining games on weekdays
        //
        // IMPORTANT: Exclude spillover matchups from this optimization!
        // Spillover games use special scheduling logic (earliest available date, ignoring day preferences)
        // so they won't actually go to Saturday even if selected here.
        const spilloverMatchupsForWeek = allMatchupsThisWeek.filter(
          (m) => m.originalWeek !== undefined && m.originalWeek !== weekNum
        );
        // Get regular matchups (not spillover) - the cost-based fairness scoring handles
        // balanced selection without needing randomization
        const regularMatchupsForWeek = allMatchupsThisWeek.filter(
          (m) => m.originalWeek === undefined || m.originalWeek === weekNum
        );

        // Get required-day dates for this week (e.g., Saturday dates)
        // Used to check if scheduling a matchup would cause short rest
        const requiredDayDates = new Set<string>();
        for (const slot of weekFieldSlots) {
          if (requiredDays.includes(slot.slot.dayOfWeek)) {
            requiredDayDates.add(slot.slot.date);
          }
        }

        // Helper to check if scheduling a team on a required day would cause short rest (≤2 days since last game)
        const wouldCauseShortRest = (teamId: string): boolean => {
          const teamState = this.teamSchedulingStates.get(teamId);
          if (!teamState || teamState.gameDates.length === 0) return false;

          // Get the team's most recent game date
          const lastGameDate = teamState.gameDates[teamState.gameDates.length - 1];

          // Check if any required day is within 2 days of the last game
          for (const reqDate of requiredDayDates) {
            const daysBetween = calculateDaysBetween(lastGameDate, reqDate);
            if (daysBetween <= 2) {
              return true;
            }
          }
          return false;
        };

        // Calculate cost for each matchup - this represents how bad it would be if this matchup
        // is NOT selected for Saturday (i.e., goes to a weekday instead).
        //
        // Key insight: If two teams with high short rest counts play each other on a weekday,
        // BOTH could get short rest from that single game. Better to put their matchup on Saturday
        // so their short rest risk is "split" across their OTHER separate matchups.
        //
        // Cost = "weekday penalty" - how much we want to AVOID putting this matchup on a weekday
        // Higher cost = prefer putting on Saturday (to avoid the weekday penalty)

        // Count how many matchups each team has this week
        const matchupsPerTeam = new Map<string, number>();
        for (const m of regularMatchupsForWeek) {
          matchupsPerTeam.set(m.homeTeamId, (matchupsPerTeam.get(m.homeTeamId) || 0) + 1);
          matchupsPerTeam.set(m.awayTeamId, (matchupsPerTeam.get(m.awayTeamId) || 0) + 1);
        }

        // Calculate average Saturday games across all teams for fairness balancing
        const allTeamIds = Array.from(preferredDayGames.keys());
        const totalPreferredGames = Array.from(preferredDayGames.values()).reduce((a, b) => a + b, 0);
        const avgPreferredGames = allTeamIds.length > 0 ? totalPreferredGames / allTeamIds.length : 0;

        const matchupCosts = regularMatchupsForWeek.map((m) => {
          // Get current short rest counts
          const homeCount = this.teamSchedulingStates.get(m.homeTeamId)?.shortRestGamesCount || 0;
          const awayCount = this.teamSchedulingStates.get(m.awayTeamId)?.shortRestGamesCount || 0;

          // Base cost: if this matchup goes to weekday, both teams risk short rest
          // Higher counts = more important to protect = higher cost to leave on weekday
          let weekdayPenalty = (homeCount + 1) + (awayCount + 1);

          // Bonus: if both teams have multiple matchups this week, putting their mutual
          // matchup on Saturday means their short rest risk is spread across separate games
          // rather than both getting hit by the same late weekday game
          const homeHasMultiple = (matchupsPerTeam.get(m.homeTeamId) || 1) > 1;
          const awayHasMultiple = (matchupsPerTeam.get(m.awayTeamId) || 1) > 1;
          if (homeHasMultiple && awayHasMultiple) {
            // Both teams have other matchups - strongly prefer putting this on Saturday
            weekdayPenalty += (homeCount + awayCount + 2) * 2;
          }

          // Previous week short rest check - if team already has a recent game,
          // Saturday would cause short rest regardless, so reduce the benefit
          const homeWouldCausePrevWeek = wouldCauseShortRest(m.homeTeamId);
          const awayWouldCausePrevWeek = wouldCauseShortRest(m.awayTeamId);
          if (homeWouldCausePrevWeek || awayWouldCausePrevWeek) {
            // Saturday would cause short rest anyway, so less benefit to putting on Saturday
            weekdayPenalty -= (homeWouldCausePrevWeek ? homeCount + 1 : 0);
            weekdayPenalty -= (awayWouldCausePrevWeek ? awayCount + 1 : 0);
          }

          // FAIRNESS: Adjust cost based on how many Saturday games each team already has
          // Teams with FEWER Saturday games should have HIGHER weekday penalty (we want to give them Saturday)
          // Teams with MORE Saturday games should have LOWER weekday penalty (OK to put on weekday)
          const homeSatGames = preferredDayGames.get(m.homeTeamId) || 0;
          const awaySatGames = preferredDayGames.get(m.awayTeamId) || 0;
          const homeDeficit = avgPreferredGames - homeSatGames; // Positive if below average
          const awayDeficit = avgPreferredGames - awaySatGames;

          // Use a strong fairness factor that dominates over other considerations
          // Teams that already have more Saturday games than others should be deprioritized
          // Scale by 20 to ensure this is the primary selection criterion
          const fairnessBonus = (homeDeficit + awayDeficit) * 20;
          weekdayPenalty += fairnessBonus;

          // Additional strong penalty if EITHER team is significantly above average
          // This prevents any one team from accumulating too many Saturday games
          const maxSatGames = Math.max(homeSatGames, awaySatGames);
          if (maxSatGames > avgPreferredGames + 1) {
            // Strong penalty for matchups involving teams that already have too many Saturdays
            weekdayPenalty -= (maxSatGames - avgPreferredGames) * 30;
          }

          // Return negative cost (backtracking minimizes cost, but we want HIGH weekday penalty = SELECTED for Saturday)
          // Actually, let's keep it as weekdayPenalty and change the backtracking to MAXIMIZE
          // Or simpler: return negative of weekdayPenalty so minimizing cost = maximizing weekday avoidance
          return -weekdayPenalty;
        });

        // Sort matchups by fairness BEFORE backtracking to ensure fairer matchups are explored first
        // This gives teams with fewer Saturday games priority in the backtracking search
        const sortedMatchupsWithCosts = regularMatchupsForWeek
          .map((m, i) => ({ matchup: m, cost: matchupCosts[i] }))
          .sort((a, b) => {
            const aHome = preferredDayGames.get(a.matchup.homeTeamId) || 0;
            const aAway = preferredDayGames.get(a.matchup.awayTeamId) || 0;
            const bHome = preferredDayGames.get(b.matchup.homeTeamId) || 0;
            const bAway = preferredDayGames.get(b.matchup.awayTeamId) || 0;

            // Primary: prefer matchups where the MAX team has fewer Saturday games
            // This avoids giving more games to teams that are already ahead
            const aMax = Math.max(aHome, aAway);
            const bMax = Math.max(bHome, bAway);
            if (aMax !== bMax) return aMax - bMax;

            // Secondary: prefer matchups where the min team has fewer Saturday games
            const aMin = Math.min(aHome, aAway);
            const bMin = Math.min(bHome, bAway);
            if (aMin !== bMin) return aMin - bMin;

            // Tertiary: use cost to break ties (varies by matchup context)
            if (a.cost !== b.cost) return a.cost - b.cost;

            // Final deterministic tiebreaker: use hash of matchup key for pseudo-random but deterministic ordering
            const aKey = [a.matchup.homeTeamId, a.matchup.awayTeamId].sort().join('-');
            const bKey = [b.matchup.homeTeamId, b.matchup.awayTeamId].sort().join('-');
            return this.simpleHash(aKey).localeCompare(this.simpleHash(bKey));
          });

        const fairnessSortedMatchups = sortedMatchupsWithCosts.map(x => x.matchup);
        const fairnessSortedCosts = sortedMatchupsWithCosts.map(x => x.cost);

        const { requiredDayMatchups, otherMatchups: nonRequiredDayMatchups } = findRequiredDayOptimalMatchups(
          fairnessSortedMatchups,
          requiredDayGameCapacity,
          fairnessSortedCosts
        );

        if (requiredDayMatchups.length > 0) {
          verboseLog(`  Week ${weekNum + 1}: Prioritizing ${requiredDayMatchups.length} matchups for required-day slots`);
        }
        if (spilloverMatchupsForWeek.length > 0) {
          verboseLog(`  Week ${weekNum + 1}: ${spilloverMatchupsForWeek.length} spillover matchups (excluded from required-day optimization)`);
        }

        // Create pools of matchups to process
        // Order: spillover first (already delayed), then required-day matchups, then weekday matchups
        const spilloverPool = [...spilloverMatchupsForWeek];
        const requiredDayPool = [...requiredDayMatchups];
        const weekdayPool = [...nonRequiredDayMatchups];

        // Track how many required-day slots we've used this week
        let requiredDaySlotsUsedThisWeek = 0;

        // Helper to pick the highest-need matchup from a pool (deterministic, needs-based)
        // Returns the index of the best matchup, or -1 if pool is empty
        // Uses multiple needs-based criteria with team ID as absolute last resort
        const pickHighestNeedMatchup = (pool: typeof spilloverPool, isSpillover: boolean): number => {
          if (pool.length === 0) return -1;

          // Compare two matchups: returns negative if a has higher need, positive if b has higher need
          const compareMatchups = (a: typeof pool[0], b: typeof pool[0]): number => {
            // 1. For spillover: oldest spillover first (lowest originalWeek)
            if (isSpillover) {
              const aOriginal = a.originalWeek ?? a.targetWeek;
              const bOriginal = b.originalWeek ?? b.targetWeek;
              if (aOriginal !== bOriginal) return aOriginal - bOriginal;
            }

            // 2. Short rest balance: matchups involving teams with MORE short rest go first
            // These teams need good slots to avoid accumulating more violations
            const aHomeState = this.teamSchedulingStates.get(a.homeTeamId);
            const aAwayState = this.teamSchedulingStates.get(a.awayTeamId);
            const bHomeState = this.teamSchedulingStates.get(b.homeTeamId);
            const bAwayState = this.teamSchedulingStates.get(b.awayTeamId);

            const aMaxShortRest = Math.max(
              aHomeState?.shortRestGamesCount || 0,
              aAwayState?.shortRestGamesCount || 0
            );
            const bMaxShortRest = Math.max(
              bHomeState?.shortRestGamesCount || 0,
              bAwayState?.shortRestGamesCount || 0
            );
            if (aMaxShortRest !== bMaxShortRest) return bMaxShortRest - aMaxShortRest; // Higher goes first

            // 3. Also consider the sum of short rest (both teams' burden)
            const aSumShortRest = (aHomeState?.shortRestGamesCount || 0) + (aAwayState?.shortRestGamesCount || 0);
            const bSumShortRest = (bHomeState?.shortRestGamesCount || 0) + (bAwayState?.shortRestGamesCount || 0);
            if (aSumShortRest !== bSumShortRest) return bSumShortRest - aSumShortRest; // Higher goes first

            // 4. Total games scheduled: teams with fewer games may need priority
            const aTotalGames = (aHomeState?.gamesScheduled || 0) + (aAwayState?.gamesScheduled || 0);
            const bTotalGames = (bHomeState?.gamesScheduled || 0) + (bAwayState?.gamesScheduled || 0);
            if (aTotalGames !== bTotalGames) return aTotalGames - bTotalGames; // Fewer goes first

            // 5. Preferred day games: teams with fewer preferred-day games get priority
            const aPreferredGames = (preferredDayGames.get(a.homeTeamId) || 0) + (preferredDayGames.get(a.awayTeamId) || 0);
            const bPreferredGames = (preferredDayGames.get(b.homeTeamId) || 0) + (preferredDayGames.get(b.awayTeamId) || 0);
            if (aPreferredGames !== bPreferredGames) return aPreferredGames - bPreferredGames; // Fewer goes first

            // 6. Home/away imbalance: prioritize matchups that could help balance
            const aHomeImbalance = Math.abs((aHomeState?.homeGames || 0) - (aHomeState?.awayGames || 0)) +
                                   Math.abs((aAwayState?.homeGames || 0) - (aAwayState?.awayGames || 0));
            const bHomeImbalance = Math.abs((bHomeState?.homeGames || 0) - (bHomeState?.awayGames || 0)) +
                                   Math.abs((bAwayState?.homeGames || 0) - (bAwayState?.awayGames || 0));
            if (aHomeImbalance !== bHomeImbalance) return bHomeImbalance - aHomeImbalance; // More imbalanced goes first

            // 7. LAST RESORT: deterministic tie-breaker using team IDs
            // Only reached when ALL needs-based criteria are exactly equal
            // Compare by creating a canonical matchup key (sorted team IDs)
            const aKey = [a.homeTeamId, a.awayTeamId].sort().join('-');
            const bKey = [b.homeTeamId, b.awayTeamId].sort().join('-');
            return aKey.localeCompare(bKey);
          };

          // Find the matchup with highest need (lowest compare result against all others)
          let bestIdx = 0;
          for (let i = 1; i < pool.length; i++) {
            if (compareMatchups(pool[i], pool[bestIdx]) < 0) {
              bestIdx = i;
            }
          }

          return bestIdx;
        };

        // Process matchups dynamically - pick highest need from current pool state
        // This ensures teams' needs are re-evaluated after each game is scheduled
        const processPool = (pool: typeof spilloverPool, isSpillover: boolean) => {
          while (pool.length > 0) {
            const idx = pickHighestNeedMatchup(pool, isSpillover);
            if (idx === -1) break;

            const matchup = pool.splice(idx, 1)[0];
        // Skip matchups already scheduled in the interleaved pre-pass
        const matchupKey = ScheduleGenerator.createMatchupKey(matchup.homeTeamId, matchup.awayTeamId, matchup.targetWeek);
        if (scheduledInPrePass.has(matchupKey)) {
          continue;
        }

        const homeTeam = teamLookup.get(matchup.homeTeamId);
        const awayTeam = teamLookup.get(matchup.awayTeamId);
        const homeTeamState = this.teamSchedulingStates.get(matchup.homeTeamId);
        const awayTeamState = this.teamSchedulingStates.get(matchup.awayTeamId);

        if (!homeTeam || !awayTeam || !homeTeamState || !awayTeamState) {
          verboseLog(`  ⚠️  Missing team data for matchup`);
          failedToSchedule++;
          continue;
        }

        // Try to schedule the matchup in the current week
        // If it fails, it will be added to spillover and tried in subsequent weeks
        let scheduled = false;
        let failureReason = '';
        const week = gameWeeks[weekNum];

        if (!week) {
          failureReason = 'target_week_not_found';
        } else {
          // Check if either team has already met their games-per-week quota for THIS week
          const homeWeekEvents = homeTeamState.eventsPerWeek.get(week.weekNumber);
          const awayWeekEvents = awayTeamState.eventsPerWeek.get(week.weekNumber);
          const homeTotalGamesThisWeek = homeWeekEvents?.games || 0;
          const awayTotalGamesThisWeek = awayWeekEvents?.games || 0;
          // Regular games = total games - spillover games
          const homeRegularGamesThisWeek = homeTotalGamesThisWeek - (homeWeekEvents?.spilloverGames || 0);
          const awayRegularGamesThisWeek = awayTotalGamesThisWeek - (awayWeekEvents?.spilloverGames || 0);
          // Use current week (weekNum) for quota lookup, not original target week
          const gamesPerWeekQuota = this.getGamesPerWeekForDivision(division.divisionId, weekNum + 1);
          const isSpillover = matchup.originalWeek !== undefined && matchup.originalWeek !== weekNum;
          const hasOverride = this.hasGameWeekOverride(division.divisionId, weekNum + 1);

          // Quota enforcement rules:
          // 1. maxGamesPerWeek: Hard cap on ALL games (regular + spillover) - if set
          // 2. Weeks WITH override: override is a hard cap on ALL games (regular + spillover)
          // 3. Weeks WITHOUT override (default): spillover games don't count against quota
          const config = this.divisionConfigs.get(division.divisionId);
          const maxGamesPerWeek = config?.maxGamesPerWeek;

          // Check maxGamesPerWeek first - this is a hard cap that always applies
          // Use != null to handle both null and undefined (when not configured)
          if (maxGamesPerWeek != null) {
            if (homeTotalGamesThisWeek >= maxGamesPerWeek) {
              failureReason = `${homeTeam.name} at max games cap (${homeTotalGamesThisWeek}/${maxGamesPerWeek} games in week ${weekNum + 1})`;
            } else if (awayTotalGamesThisWeek >= maxGamesPerWeek) {
              failureReason = `${awayTeam.name} at max games cap (${awayTotalGamesThisWeek}/${maxGamesPerWeek} games in week ${weekNum + 1})`;
            }
          }

          // Then check override/regular quota rules
          if (!failureReason && hasOverride) {
            // Override weeks: enforce quota as hard cap on ALL games
            if (homeTotalGamesThisWeek >= gamesPerWeekQuota) {
              failureReason = `${homeTeam.name} at override cap (${homeTotalGamesThisWeek}/${gamesPerWeekQuota} games in week ${weekNum + 1})`;
            } else if (awayTotalGamesThisWeek >= gamesPerWeekQuota) {
              failureReason = `${awayTeam.name} at override cap (${awayTotalGamesThisWeek}/${gamesPerWeekQuota} games in week ${weekNum + 1})`;
            }
          } else if (!failureReason && !isSpillover) {
            // Non-override weeks: only regular games count against quota (spillover are "extra")
            if (homeRegularGamesThisWeek >= gamesPerWeekQuota) {
              failureReason = `${homeTeam.name} already at quota (${homeRegularGamesThisWeek}/${gamesPerWeekQuota})`;
            } else if (awayRegularGamesThisWeek >= gamesPerWeekQuota) {
              failureReason = `${awayTeam.name} already at quota (${awayRegularGamesThisWeek}/${gamesPerWeekQuota})`;
            }
          }

          if (!failureReason) {
            // Use pre-filtered field slots for this week (not target week)
            const currentWeekFieldSlots = fieldSlotsByWeek.get(weekNum) || [];

            if (currentWeekFieldSlots.length === 0) {
              failureReason = 'no_compatible_field_slots';
            } else {
              // Generate placement candidates for this game
              const candidates = generateCandidatesForGame(
                matchup,
                currentWeekFieldSlots,
                week,
                totalGameSlotHours,
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

                // For spillover games, use special logic: pick earliest available date,
                // ignoring ALL day preferences - spillover games are catch-up games that
                // should just go to the soonest available slot. We don't prioritize required
                // days for spillover because it can cause matchup spacing violations.
                if (isSpillover) {
                  // Group candidates by date
                  const candidatesByDate = new Map<string, PlacementCandidate[]>();
                  for (const c of filteredCandidates) {
                    if (!candidatesByDate.has(c.date)) {
                      candidatesByDate.set(c.date, []);
                    }
                    candidatesByDate.get(c.date)!.push(c);
                  }

                  // Sort dates ascending (earliest first)
                  const sortedDates = Array.from(candidatesByDate.keys()).sort();

                  // Create modified weights with gameDayPreference = 0 for spillover games
                  const spilloverWeights = { ...this.scoringWeights, gameDayPreference: 0 };

                  // Try each date in order until we find a valid candidate
                  // No budget checks - spillover games take the first available slot
                  for (const date of sortedDates) {
                    const dateCandidates = candidatesByDate.get(date)!;

                    const scoredCandidates = dateCandidates.map((c) =>
                      calculatePlacementScore(c, homeTeamState, this.scoringContext!, spilloverWeights)
                    );
                    scoredCandidates.sort((a, b) => {
                      const scoreDiff = b.score - a.score;
                      if (scoreDiff !== 0) return scoreDiff;
                      return compareCandidatesForTiebreak(a, b);
                    });
                    const best = scoredCandidates[0];

                    // Accept if no severe penalty
                    if (best && best.score > -500000) {
                      bestCandidate = best;
                      verboseLog(`  ⏩ Spillover game using earliest available date: ${date}`);
                      break;
                    }
                  }

                  // If no valid candidate found on any date, bestCandidate remains undefined
                } else if (strictlyRequiredDays.length > 0 || preferredDays.length > 0) {
                  // Three-phase approach: strictly required > preferred > other days
                  // This ensures Saturday (required) is always prioritized over Tue/Wed/Thu (preferred)

                  // Helper to find best candidate from a set of days
                  const findBestFromDays = (days: number[], checkBudget: boolean): ScoredCandidate | undefined => {
                    let dayCandidates = filteredCandidates.filter(c => days.includes(c.dayOfWeek));
                    if (checkBudget) {
                      dayCandidates = dayCandidates.filter(c =>
                        canUseRequiredDaySlot(division.divisionId, c.dayOfWeek, weekNum, requiredDayBudgetTracker)
                      );
                    }
                    if (dayCandidates.length === 0) return undefined;
                    const scored = dayCandidates.map(c =>
                      calculatePlacementScore(c, homeTeamState, this.scoringContext!, this.scoringWeights)
                    );
                    scored.sort((a, b) => {
                      const scoreDiff = b.score - a.score;
                      if (scoreDiff !== 0) return scoreDiff;
                      return compareCandidatesForTiebreak(a, b);
                    });
                    const best = scored[0];
                    // Only return if no hard constraint violation
                    return best && best.score > -500000 ? best : undefined;
                  };

                  // Phase 1: Try strictly required days first (e.g., Saturday)
                  if (strictlyRequiredDays.length > 0) {
                    const hasStrictBudget = strictlyRequiredDays.some(day =>
                      canUseRequiredDaySlot(division.divisionId, day, weekNum, requiredDayBudgetTracker)
                    );
                    if (hasStrictBudget) {
                      bestCandidate = findBestFromDays(strictlyRequiredDays, true);
                    }
                  }

                  // Phase 2: If no valid strictly required day, try preferred days (e.g., Tue/Wed/Thu)
                  if (!bestCandidate && preferredDays.length > 0) {
                    const hasPreferredBudget = preferredDays.some(day =>
                      canUseRequiredDaySlot(division.divisionId, day, weekNum, requiredDayBudgetTracker)
                    );
                    if (hasPreferredBudget) {
                      bestCandidate = findBestFromDays(preferredDays, true);
                      if (bestCandidate) usedFallback = true;
                    }
                  }

                  // Phase 3: Fall back to non-priority days (acceptable/avoid)
                  if (!bestCandidate) {
                    usedFallback = true;
                    const nonPriorityDays = filteredCandidates.filter(c =>
                      !strictlyRequiredDays.includes(c.dayOfWeek) && !preferredDays.includes(c.dayOfWeek)
                    );
                    if (nonPriorityDays.length > 0) {
                      const scored = nonPriorityDays.map(c =>
                        calculatePlacementScore(c, homeTeamState, this.scoringContext!, this.scoringWeights)
                      );
                      scored.sort((a, b) => {
                        const scoreDiff = b.score - a.score;
                        if (scoreDiff !== 0) return scoreDiff;
                        return compareCandidatesForTiebreak(a, b);
                      });
                      if (scored[0] && scored[0].score > -500000) {
                        bestCandidate = scored[0];
                        this.log('warning', 'game', `Non-priority day selected for ${homeTeam.name} vs ${awayTeam.name}`, {
                          selectedDate: bestCandidate.date,
                          selectedDay: ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek],
                        }, `Game scheduled on ${ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek]} instead of priority day`);
                      }
                    }
                  }
                } else {
                  // No required days configured - score all candidates normally
                  const scoredCandidates = filteredCandidates.map((c) =>
                    calculatePlacementScore(c, homeTeamState, this.scoringContext!, this.scoringWeights)
                  );
                  scoredCandidates.sort((a, b) => {
                    const scoreDiff = b.score - a.score;
                    if (scoreDiff !== 0) return scoreDiff;
                    return compareCandidatesForTiebreak(a, b);
                  });
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

                  // Determine if this is a spillover game (from a previous week)
                  const originalWeek = (matchup as any).originalWeek ?? matchup.targetWeek;
                  const isSpilloverGame = originalWeek !== weekNum;

                  // Update both team states - pass isSpilloverGame so spillover games don't count against quota
                  updateTeamStateAfterScheduling(homeTeamState, eventDraft, week.weekNumber, true, awayTeamState.teamId, isSpilloverGame);
                  updateTeamStateAfterScheduling(awayTeamState, eventDraft, week.weekNumber, false, homeTeamState.teamId, isSpilloverGame);

                  // Update resource usage
                  updateResourceUsage(this.scoringContext!, bestCandidate.resourceId, bestCandidate.date, totalGameSlotHours);

                  const dayName = ScheduleGenerator.DAY_NAMES[bestCandidate.dayOfWeek];
                  const spilloverNote = isSpilloverGame ? ` (spillover from week ${originalWeek + 1})` : '';

                  verboseLog(`  ✅ ${homeTeam.name} vs ${awayTeam.name}: Week ${week.weekNumber + 1} ${bestCandidate.date} (${dayName}) ${bestCandidate.startTime}-${bestCandidate.endTime} @ ${bestCandidate.resourceName}${spilloverNote}`);

                  this.log('info', 'game', `Scheduled game: ${homeTeam.name} vs ${awayTeam.name}${spilloverNote}`, {
                    homeTeamId: bestCandidate.homeTeamId,
                    awayTeamId: bestCandidate.awayTeamId,
                    date: bestCandidate.date,
                    originalWeek,
                    scheduledWeek: weekNum,
                    isSpillover: isSpilloverGame,
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

                    // Record usage for required-day budget tracking (per-week)
                    recordRequiredDayUsage(
                      division.divisionId,
                      bestCandidate.dayOfWeek,
                      weekNum,
                      requiredDayBudgetTracker,
                      this.divisionNames
                    );
                  }

                  totalScheduled++;
                  scheduled = true;
                  // Debug: log Majors scheduling on week 11 dates
                  if (division.divisionName === 'Majors' && bestCandidate.date >= '2026-05-11' && bestCandidate.date <= '2026-05-17') {
                    console.log(`  [Scheduled] week ${weekNum + 1}: ${homeTeam.name} vs ${awayTeam.name} → ${bestCandidate.date} ${bestCandidate.startTime}`);
                  }
                }
              }
            }
          }
        }

        if (!scheduled) {
          const weekDates = week ? `${week.startDate} to ${week.endDate}` : 'unknown';
          const originalWeek = (matchup as any).originalWeek ?? matchup.targetWeek;
          const isSpillover = originalWeek !== weekNum;

          // If there are more weeks to try, add to spillover
          if (weekNum < gameWeeks.length - 1) {
            newSpillover.push({
              ...matchup,
              targetWeek: weekNum, // Update target week for next iteration
              originalWeek,
            });
            // Log spillover reasons for Majors to diagnose failures
            if (division.divisionName === 'Majors' && weekNum <= 1) {
              console.log(`  [Spillover] ${homeTeam.name} vs ${awayTeam.name} week ${weekNum + 1} (orig week ${originalWeek + 1}): ${failureReason}`);
              // Debug: show what dates these teams have events on (both field and cage)
              const homeState = this.teamSchedulingStates.get(matchup.homeTeamId);
              const awayState = this.teamSchedulingStates.get(matchup.awayTeamId);
              const week = gameWeeks[weekNum];
              const homeFieldDates = week.dates.filter(d => homeState?.fieldDatesUsed.has(d));
              const homeCageDates = week.dates.filter(d => homeState?.cageDatesUsed.has(d));
              const awayFieldDates = week.dates.filter(d => awayState?.fieldDatesUsed.has(d));
              const awayCageDates = week.dates.filter(d => awayState?.cageDatesUsed.has(d));
              // Check what dates are theoretically free for both teams
              const availDates = week.dates;
              const freeDates = availDates.filter(d =>
                !homeState?.fieldDatesUsed.has(d) && !homeState?.cageDatesUsed.has(d) &&
                !awayState?.fieldDatesUsed.has(d) && !awayState?.cageDatesUsed.has(d)
              );
              console.log(`    ${homeTeam.name}: field=${homeFieldDates.join(',') || 'none'}, cage=${homeCageDates.join(',') || 'none'}`);
              console.log(`    ${awayTeam.name}: field=${awayFieldDates.join(',') || 'none'}, cage=${awayCageDates.join(',') || 'none'}`);
              console.log(`    Free dates for both: ${freeDates.join(',') || 'none'}`);
            }
            if (isSpillover) {
              verboseLog(`  ⏩ Spillover continues: ${homeTeam.name} vs ${awayTeam.name} (originally week ${originalWeek + 1}, tried week ${weekNum + 1}): ${failureReason}`);
            } else {
              verboseLog(`  ⏩ Adding to spillover: ${homeTeam.name} vs ${awayTeam.name} (week ${weekNum + 1}): ${failureReason}`);
            }
          } else {
            // No more weeks - this is a true failure
            console.log(`  [ScheduleFailed] ${division.divisionName}: ${homeTeam.name} vs ${awayTeam.name} (orig week ${originalWeek + 1}, last tried ${weekNum + 1}): ${failureReason}`);
            verboseLog(`  ❌ Could not schedule: ${homeTeam.name} vs ${awayTeam.name} (originally week ${originalWeek + 1}, last tried week ${weekNum + 1}): ${failureReason}`);

            const failureSummary = `Could not schedule ${homeTeam.name} vs ${awayTeam.name}. Originally targeted week ${originalWeek + 1}, failed through week ${weekNum + 1}.\nReason: ${failureReason}`;

            this.log('warning', 'game', `Failed to schedule matchup: ${homeTeam.name} vs ${awayTeam.name}`, {
              homeTeamId: matchup.homeTeamId,
              awayTeamId: matchup.awayTeamId,
              divisionId: division.divisionId,
              originalWeek,
              lastTriedWeek: weekNum,
              weekDates,
              reason: failureReason,
            }, failureSummary);
            failedToSchedule++;
          }
        }
          } // end while loop in processPool
        }; // end processPool function

        // Process each pool in order: spillover first, then required-day, then weekday
        // Each call dynamically picks the highest-need matchup from the current pool state
        processPool(spilloverPool, true);
        processPool(requiredDayPool, false);
        processPool(weekdayPool, false);

        // Carry forward any matchups that couldn't be scheduled this week
        spilloverMatchups = newSpillover;
        if (spilloverMatchups.length > 0) {
          verboseLog(`  📋 ${spilloverMatchups.length} matchups spilling over to next week`);
        }
      } // end week loop

      // Redistribute unused required-day quota to remaining divisions
      const remainingDivisionIds = divisionMatchupsList
        .slice(divisionIndex + 1)
        .map((d) => d.divisionId);
      redistributeUnusedQuota(
        division.divisionId,
        remainingDivisionIds,
        requiredDayBudgetTracker,
        this.divisionNames
      );
    } // end division loop

    // ============ GAME COUNT REBALANCING ============
    // After all scheduling, try to rebalance game counts for divisions with delta > 0
    // by scheduling remaining matchups for underrepresented teams.
    // Keep iterating until no more progress can be made.
    for (const division of divisionMatchupsList) {
      let rebalanceScheduled = 0;
      let rebalancePass = 0;
      let madeProgress = true;

      while (madeProgress) {
        rebalancePass++;
        madeProgress = false;

        // Calculate current game counts
        const teamGameCounts = new Map<string, number>();
        for (const team of division.teams) {
          const teamState = this.teamSchedulingStates.get(team.id);
          teamGameCounts.set(team.id, teamState?.gamesScheduled || 0);
        }

        const counts = Array.from(teamGameCounts.values());
        const minGames = Math.min(...counts);
        const maxGames = Math.max(...counts);
        const delta = maxGames - minGames;

        if (delta === 0) break; // Already perfectly balanced

        // Log that we're attempting rebalancing for this division
        if (rebalancePass === 1 && delta > 0) {
          console.log(`  [GameRebalance] ${division.divisionName}: starting rebalancing with delta=${delta}`);
        }

      // Find teams with min games
      const minGameTeams = new Set<string>();
      for (const [teamId, games] of teamGameCounts.entries()) {
        if (games === minGames) minGameTeams.add(teamId);
      }

      // Find unscheduled matchups involving min-game teams
      // Use a simpler approach: count scheduled games per pairing, compare to expected matchups per pairing
      const scheduledPairings = new Map<string, number>(); // pairingKey -> count of scheduled games
      for (const event of this.scheduledEvents) {
        if (event.eventType === 'game' && event.divisionId === division.divisionId && event.homeTeamId && event.awayTeamId) {
          // Create pairing key (sorted team IDs so order doesn't matter)
          const pairingKey = [event.homeTeamId, event.awayTeamId].sort().join('-');
          scheduledPairings.set(pairingKey, (scheduledPairings.get(pairingKey) || 0) + 1);
        }
      }

      // Count expected matchups per pairing
      const expectedPairings = new Map<string, number>();
      for (const m of division.matchups) {
        const pairingKey = [m.homeTeamId, m.awayTeamId].sort().join('-');
        expectedPairings.set(pairingKey, (expectedPairings.get(pairingKey) || 0) + 1);
      }

      // Find pairings that have fewer scheduled games than expected matchups
      // Only include matchups where:
      // 1. At least one team has minGames
      // 2. The OTHER team won't exceed maxGames after scheduling
      const unscheduledMatchups: Array<typeof division.matchups[0]> = [];
      for (const m of division.matchups) {
        const pairingKey = [m.homeTeamId, m.awayTeamId].sort().join('-');
        const scheduled = scheduledPairings.get(pairingKey) || 0;
        const expected = expectedPairings.get(pairingKey) || 0;
        if (scheduled < expected) {
          const homeGames = teamGameCounts.get(m.homeTeamId) || 0;
          const awayGames = teamGameCounts.get(m.awayTeamId) || 0;
          const homeIsMin = minGameTeams.has(m.homeTeamId);
          const awayIsMin = minGameTeams.has(m.awayTeamId);

          // At least one team should have min games
          if (!homeIsMin && !awayIsMin) continue;

          // The other team shouldn't exceed maxGames after scheduling
          // (We're trying to reduce delta, not increase it)
          if (homeIsMin && awayGames >= maxGames) continue;
          if (awayIsMin && homeGames >= maxGames) continue;

          // Mark one matchup as "used" by incrementing scheduled count
          scheduledPairings.set(pairingKey, scheduled + 1);
          unscheduledMatchups.push(m);
        }
      }

        if (unscheduledMatchups.length === 0) {
          if (rebalancePass === 1 && delta > 0) {
            console.log(`    [GameRebalance] ${division.divisionName}: no eligible unscheduled matchups found (delta=${delta} but cannot improve)`);
          }
          break; // No more matchups to try, exit while loop
        }

        console.log(`  [GameRebalance] ${division.divisionName}: pass ${rebalancePass}, delta=${delta}, found ${unscheduledMatchups.length} eligible unscheduled matchups`);

        // Get total game slot hours for this division
        const totalGameSlotHours = division.config.gameDurationHours + (division.config.gameArriveBeforeHours || 0);

        // Try to schedule unscheduled matchups on any available slot
        let matchupsAttempted = 0;
        let matchupsScheduled = 0;
      for (const matchup of unscheduledMatchups) {
        matchupsAttempted++;
        let scheduled = false;
        let weeksWithNoSlots = 0;
        let weeksWithNoCandidates = 0;
        let weeksWithHardConstraint = 0;
        // Find any week with available slots
        for (let weekNum = 0; weekNum < gameWeeks.length; weekNum++) {
          const week = gameWeeks[weekNum];
          const weekDatesSet = new Set(week.dates);

          // Get slots for this week
          const weekSlots = this.gameFieldSlots.filter(rs =>
            weekDatesSet.has(rs.slot.date) &&
            this.isFieldCompatibleWithDivision(rs.resourceId, division.divisionId) &&
            !this.isDateBlockedForDivision(rs.slot.date, 'game', division.divisionId)
          );

          if (weekSlots.length === 0) {
            weeksWithNoSlots++;
            continue;
          }

          const homeTeamState = this.teamSchedulingStates.get(matchup.homeTeamId);
          const awayTeamState = this.teamSchedulingStates.get(matchup.awayTeamId);
          if (!homeTeamState || !awayTeamState) continue;

          // Check maxGamesPerWeek cap for both teams (hard limit if set)
          const maxGamesPerWeek = division.config.maxGamesPerWeek;
          if (maxGamesPerWeek != null) {
            const homeGamesThisWeek = homeTeamState.eventsPerWeek.get(week.weekNumber)?.games || 0;
            const awayGamesThisWeek = awayTeamState.eventsPerWeek.get(week.weekNumber)?.games || 0;
            if (homeGamesThisWeek >= maxGamesPerWeek || awayGamesThisWeek >= maxGamesPerWeek) {
              continue; // Skip this week - one of the teams is at max cap
            }
          }

          // Generate candidates (ignoring day preferences - just find any slot)
          const candidates = generateCandidatesForGame(
            matchup,
            weekSlots,
            week,
            totalGameSlotHours,
            this.season.id,
            this.scoringContext!
          );

          if (candidates.length === 0) {
            // No candidates for this week - all slots likely have conflicts
            weeksWithNoCandidates++;
            continue;
          }

          // Score candidates and find best
          const scoredCandidates = candidates.map(c =>
            calculatePlacementScore(c, homeTeamState, this.scoringContext!, this.scoringWeights)
          );
          scoredCandidates.sort((a, b) => {
            const scoreDiff = b.score - a.score;
            if (scoreDiff !== 0) return scoreDiff;
            return compareCandidatesForTiebreak(a, b);
          });
          const bestCandidate = scoredCandidates[0];

          // Accept if not a hard constraint violation
          if (!bestCandidate || bestCandidate.score <= -500000) {
            weeksWithHardConstraint++;
            continue;
          }
          if (bestCandidate) {
            const eventDraft = candidateToEventDraft(bestCandidate, division.divisionId);
            this.scheduledEvents.push(eventDraft);
            addEventToContext(this.scoringContext!, eventDraft);

            // Update team states
            updateTeamStateAfterScheduling(homeTeamState, eventDraft, week.weekNumber, true, awayTeamState.teamId, false);
            updateTeamStateAfterScheduling(awayTeamState, eventDraft, week.weekNumber, false, homeTeamState.teamId, false);

            // Update resource usage
            updateResourceUsage(this.scoringContext!, bestCandidate.resourceId, bestCandidate.date, totalGameSlotHours);

            rebalanceScheduled++;
            totalScheduled++;
            matchupsScheduled++;
            scheduled = true;
            madeProgress = true; // Signal that we made progress, continue rebalancing

            const homeTeam = division.teams.find(t => t.id === matchup.homeTeamId);
            const awayTeam = division.teams.find(t => t.id === matchup.awayTeamId);
            console.log(`    [GameRebalance] Scheduled ${homeTeam?.name} vs ${awayTeam?.name} → ${bestCandidate.date} ${bestCandidate.startTime}`);

            break; // Move to next unscheduled matchup
          }
        }
        // Log why this matchup couldn't be scheduled
        if (!scheduled) {
          const homeTeam = division.teams.find(t => t.id === matchup.homeTeamId);
          const awayTeam = division.teams.find(t => t.id === matchup.awayTeamId);
          console.log(`    [GameRebalance] Failed: ${homeTeam?.name} vs ${awayTeam?.name} - tried ${gameWeeks.length} weeks: noSlots=${weeksWithNoSlots}, noCandidates=${weeksWithNoCandidates}, hardConstraint=${weeksWithHardConstraint}`);
        }
      }
        // Log pass summary if some matchups couldn't be scheduled
        if (matchupsAttempted > matchupsScheduled) {
          console.log(`    [GameRebalance] Pass ${rebalancePass}: ${matchupsScheduled}/${matchupsAttempted} matchups scheduled`);
        }
      } // end while (madeProgress)

      if (rebalanceScheduled > 0) {
        console.log(`    [GameRebalance] ${division.divisionName}: scheduled ${rebalanceScheduled} additional game(s)`);
      }
    }

    // Report summary
    const totalGames = this.scheduledEvents.filter((e) => e.eventType === 'game').length;
    verboseLog(`\n✅ Game scheduling complete. Scheduled: ${totalScheduled}, Failed: ${failedToSchedule}`);

    // Report per-team game counts and check for imbalance
    for (const division of divisionMatchupsList) {
      const teamGameCounts: Array<{ name: string; games: number }> = [];
      for (const team of division.teams) {
        const teamState = this.teamSchedulingStates.get(team.id);
        if (teamState) {
          teamGameCounts.push({ name: team.name, games: teamState.gamesScheduled });
        }
      }
      const counts = teamGameCounts.map(t => t.games);
      const minGames = Math.min(...counts);
      const maxGames = Math.max(...counts);
      const delta = maxGames - minGames;
      const countSummary = teamGameCounts.map(t => `${t.name}:${t.games}`).join(', ');
      console.log(`  [GameBalance] ${division.divisionName}: ${countSummary} (delta=${delta}${delta > 2 ? ' ⚠️' : ''})`);
    }

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

        // If there's a total shortfall, create a warning
        const totalExpected = this.getTotalGamesPerTeam(division.divisionId, gameWeeks);
        const totalShortfall = totalExpected - teamState.gamesScheduled;
        if (totalShortfall > 0) {

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
   * Create a unique key for a matchup (used to track scheduled matchups).
   */
  private static createMatchupKey(homeTeamId: string, awayTeamId: string, targetWeek: number): string {
    return `${homeTeamId}|${awayTeamId}|${targetWeek}`;
  }

  /**
   * Schedule competition group games in an interleaved fashion.
   * This ensures divisions sharing a primary field get interleaved time slots
   * rather than one division taking all early slots.
   *
   * Returns a Set of matchup keys that were scheduled in the pre-pass.
   */
  private scheduleCompetitionGroupGamesInterleaved(
    competitionGroups: CompetitionGroup[],
    requiredDayBudgetTracker: RequiredDayBudgetTracker,
    divisionMatchupsList: Array<{
      divisionId: string;
      divisionName: string;
      teams: Team[];
      config: { gamesPerWeek: number; gameDurationHours: number; gameArriveBeforeHours?: number; maxGamesPerWeek?: number };
      matchups: Array<GameMatchup & { targetWeek: number }>;
    }>,
    gameWeeks: WeekDefinition[]
  ): Set<string> {
    const scheduledMatchupKeys = new Set<string>();

    if (competitionGroups.length === 0) {
      return scheduledMatchupKeys;
    }

    console.log(`\n[Interleaved] Starting interleaved scheduling for ${competitionGroups.length} competition groups`);

    // Build lookup: divisionId -> division data
    const divisionLookup = new Map<string, typeof divisionMatchupsList[0]>();
    for (const div of divisionMatchupsList) {
      divisionLookup.set(div.divisionId, div);
    }

    // Track games per team per priority level for fairness balancing
    // This ensures fair distribution within each priority level (required, preferred, acceptable)
    const gamesPerTeamByPriority = new Map<string, Map<string, number>>();
    for (const priority of ['required', 'preferred', 'acceptable']) {
      const priorityMap = new Map<string, number>();
      for (const div of divisionMatchupsList) {
        for (const team of div.teams) {
          priorityMap.set(team.id, 0);
        }
      }
      gamesPerTeamByPriority.set(priority, priorityMap);
    }

    // Group competition groups by their highest priority level
    // A group's priority is the highest (most important) priority among its divisions
    const hasRequired = (g: typeof competitionGroups[0]) =>
      g.divisionPreferences.some(p => p.priority === 'required');
    const hasPreferred = (g: typeof competitionGroups[0]) =>
      g.divisionPreferences.some(p => p.priority === 'preferred');

    const requiredGroups = competitionGroups.filter(g => hasRequired(g));
    const preferredGroups = competitionGroups.filter(g => !hasRequired(g) && hasPreferred(g));
    const acceptableGroups = competitionGroups.filter(g => !hasRequired(g) && !hasPreferred(g));

    // Process week-by-week, with all priority tiers within each week.
    // This allows us to track overflow from Saturday (required) and give it priority
    // on Tuesday/Monday (preferred/acceptable) within the SAME week.
    const priorityLevels = [
      { name: 'required', groups: requiredGroups },
      { name: 'preferred', groups: preferredGroups },
      { name: 'acceptable', groups: acceptableGroups },
    ];

    // Track overflow matchups - games that were attempted but couldn't be scheduled on higher-priority days
    // These specific matchups get priority on lower-priority days within the same week
    // Key: matchup key (homeTeamId-awayTeamId-targetWeek), Value: true if overflow
    let overflowMatchups = new Set<string>();

    for (let weekNum = 0; weekNum < gameWeeks.length; weekNum++) {
      const week = gameWeeks[weekNum];
      const weekDatesSet = new Set(week.dates);

      // Reset overflow tracking at start of each week
      overflowMatchups = new Set<string>();


      for (const { name: priorityName, groups: priorityGroups } of priorityLevels) {
        if (priorityGroups.length === 0) continue;

        // POOLED APPROACH: Collect all divisions and their available days for this priority tier
        // This allows fair alternation across ALL days in the tier, not just within each day
        const allDivisionsInTier = new Set<string>();
        const divisionToGroups = new Map<string, typeof priorityGroups>();

        for (const group of priorityGroups) {
          for (const pref of group.divisionPreferences) {
            allDivisionsInTier.add(pref.divisionId);
            const existing = divisionToGroups.get(pref.divisionId) || [];
            existing.push(group);
            divisionToGroups.set(pref.divisionId, existing);
          }
        }

        // Build ordered list of divisions, rotating each week for fairness
        const divisionList = Array.from(allDivisionsInTier);
        const rotationOffset = weekNum % divisionList.length;
        for (let i = 0; i < rotationOffset; i++) {
          divisionList.push(divisionList.shift()!);
        }

        // Collect matchups for each division
        const divisionMatchupQueues = new Map<string, Array<GameMatchup & { targetWeek: number }>>();
        for (const divisionId of divisionList) {
          const divData = divisionLookup.get(divisionId);
          if (!divData) continue;

          const weekMatchups = divData.matchups.filter((m) => {
            const key = ScheduleGenerator.createMatchupKey(m.homeTeamId, m.awayTeamId, m.targetWeek);
            return m.targetWeek >= weekNum && !scheduledMatchupKeys.has(key);
          });
          divisionMatchupQueues.set(divisionId, [...weekMatchups]);
        }

        // Round-robin through divisions, letting each pick from ANY day in their available groups
        let scheduledThisTier = 0;
        let continueScheduling = true;
        let roundNum = 0;

        while (continueScheduling) {
          continueScheduling = false;
          roundNum++;

          // Go through divisions in rotated order
          for (const divisionId of divisionList) {
            const divData = divisionLookup.get(divisionId);
            if (!divData) continue;

            const queue = divisionMatchupQueues.get(divisionId);
            const divName = this.divisionNames.get(divisionId) || divisionId;

            if (!queue || queue.length === 0) {
              continue;
            }

            // Get all groups (days) this division can use
            const availableGroups = divisionToGroups.get(divisionId) || [];

            // Sort queue to prioritize:
            // 1. Overflow matchups (couldn't be scheduled on higher-priority days this week)
            // 2. Then by team fairness (help underrepresented teams)
            const priorityGamesPerTeam = gamesPerTeamByPriority.get(priorityName)!;
            const teamIds = divData.teams.map(t => t.id);
            const totalPriorityGames = teamIds.reduce((sum, id) => sum + (priorityGamesPerTeam.get(id) || 0), 0);
            const avgPriorityGames = teamIds.length > 0 ? totalPriorityGames / teamIds.length : 0;

            queue.sort((a, b) => {
              // First: overflow matchups come first (they couldn't fit on higher-priority days)
              const aKey = ScheduleGenerator.createMatchupKey(a.homeTeamId, a.awayTeamId, a.targetWeek);
              const bKey = ScheduleGenerator.createMatchupKey(b.homeTeamId, b.awayTeamId, b.targetWeek);
              const aIsOverflow = overflowMatchups.has(aKey);
              const bIsOverflow = overflowMatchups.has(bKey);
              if (aIsOverflow && !bIsOverflow) return -1;
              if (!aIsOverflow && bIsOverflow) return 1;

              // Second: prefer matchups targeted for current week over future weeks
              // This ensures matchups are scheduled in their intended weeks for even distribution
              const aIsCurrentWeek = a.targetWeek === weekNum;
              const bIsCurrentWeek = b.targetWeek === weekNum;
              if (aIsCurrentWeek && !bIsCurrentWeek) return -1;
              if (!aIsCurrentWeek && bIsCurrentWeek) return 1;

              // Third: total game balance - prioritize matchups involving teams with fewer total games
              // This ensures teams that are falling behind get first pick of available slots
              const aHomeTotalGames = this.teamSchedulingStates.get(a.homeTeamId)?.gamesScheduled || 0;
              const aAwayTotalGames = this.teamSchedulingStates.get(a.awayTeamId)?.gamesScheduled || 0;
              const bHomeTotalGames = this.teamSchedulingStates.get(b.homeTeamId)?.gamesScheduled || 0;
              const bAwayTotalGames = this.teamSchedulingStates.get(b.awayTeamId)?.gamesScheduled || 0;
              const aTotalMin = Math.min(aHomeTotalGames, aAwayTotalGames);
              const bTotalMin = Math.min(bHomeTotalGames, bAwayTotalGames);
              if (aTotalMin !== bTotalMin) return aTotalMin - bTotalMin; // Fewer total games goes first

              // Fourth: short rest balance - teams with more short rest games go first
              // This gives them first pick of slots that don't create more short rest
              const aHomeShortRest = this.teamSchedulingStates.get(a.homeTeamId)?.shortRestGamesCount || 0;
              const aAwayShortRest = this.teamSchedulingStates.get(a.awayTeamId)?.shortRestGamesCount || 0;
              const bHomeShortRest = this.teamSchedulingStates.get(b.homeTeamId)?.shortRestGamesCount || 0;
              const bAwayShortRest = this.teamSchedulingStates.get(b.awayTeamId)?.shortRestGamesCount || 0;
              const aMaxShortRest = Math.max(aHomeShortRest, aAwayShortRest);
              const bMaxShortRest = Math.max(bHomeShortRest, bAwayShortRest);
              if (aMaxShortRest !== bMaxShortRest) {
                return bMaxShortRest - aMaxShortRest; // Higher short rest count goes first
              }

              // Fifth: team fairness - prioritize matchups involving teams with fewer games at this priority level
              const aHome = priorityGamesPerTeam.get(a.homeTeamId) || 0;
              const aAway = priorityGamesPerTeam.get(a.awayTeamId) || 0;
              const bHome = priorityGamesPerTeam.get(b.homeTeamId) || 0;
              const bAway = priorityGamesPerTeam.get(b.awayTeamId) || 0;
              const aMin = Math.min(aHome, aAway);
              const bMin = Math.min(bHome, bAway);
              if (aMin !== bMin) return aMin - bMin;
              const aDeficit = (avgPriorityGames - aHome) + (avgPriorityGames - aAway);
              const bDeficit = (avgPriorityGames - bHome) + (avgPriorityGames - bAway);
              if (aDeficit !== bDeficit) return bDeficit - aDeficit;
              const maxDiff = Math.max(aHome, aAway) - Math.max(bHome, bAway);
              if (maxDiff !== 0) return maxDiff;

              // Deterministic tiebreaker: use hash of matchup key for pseudo-random but deterministic ordering
              // This distributes ties more evenly than alphabetical comparison which can create bias
              const aMatchupKey = [a.homeTeamId, a.awayTeamId].sort().join('-');
              const bMatchupKey = [b.homeTeamId, b.awayTeamId].sort().join('-');
              return this.simpleHash(aMatchupKey).localeCompare(this.simpleHash(bMatchupKey));
            });

            // Try to schedule on ANY available day in this tier
            const totalGameSlotHours = divData.config.gameDurationHours + (divData.config.gameArriveBeforeHours || 0);
            let scheduled = false;

            for (const group of availableGroups) {
              if (scheduled) break;

              const dayOfWeek = group.dayOfWeek;

              // Check budget for this day
              if (!canUseRequiredDaySlot(divisionId, dayOfWeek, weekNum, requiredDayBudgetTracker)) {
                continue;
              }

              // Find slots on this day
              const daySlots = this.gameFieldSlots.filter((rs) =>
                weekDatesSet.has(rs.slot.date) &&
                rs.slot.dayOfWeek === dayOfWeek &&
                rs.resourceId === group.primaryFieldId &&
                this.isFieldCompatibleWithDivision(rs.resourceId, divisionId) &&
                !this.isDateBlockedForDivision(rs.slot.date, 'game', divisionId)
              );

              if (daySlots.length === 0) {
                continue;
              }

              // Try matchups until one succeeds
              let scheduledMatchup: (GameMatchup & { targetWeek: number }) | null = null;
              let scheduledMatchupIndex = -1;
              let bestCandidate: ReturnType<typeof calculatePlacementScore> | null = null;
              let homeTeamState: TeamSchedulingState | null = null;
              let awayTeamState: TeamSchedulingState | null = null;

              for (let matchupIndex = 0; matchupIndex < queue.length; matchupIndex++) {
                const matchup = queue[matchupIndex];

                // Generate candidates for this game on competition group day only
                const candidates = generateCandidatesForGame(
                  matchup,
                  daySlots,
                  week,
                  totalGameSlotHours,
                  this.season.id,
                  this.scoringContext!
                );

                if (candidates.length === 0) {
                  continue; // Try next matchup
                }

                // Score and pick best candidate
                const hState = this.teamSchedulingStates.get(matchup.homeTeamId);
                if (!hState) {
                  continue; // Try next matchup
                }

                const scoredCandidates = candidates.map((c) =>
                  calculatePlacementScore(c, hState, this.scoringContext!, this.scoringWeights)
                );
                scoredCandidates.sort((a, b) => {
                  const scoreDiff = b.score - a.score;
                  if (scoreDiff !== 0) return scoreDiff;
                  return compareCandidatesForTiebreak(a, b);
                });
                const candidate = scoredCandidates[0];

                // Check for hard constraint violations
                if (!candidate || candidate.score <= -500000) {
                  continue; // Try next matchup
                }

                // Check away team state
                const aState = this.teamSchedulingStates.get(matchup.awayTeamId);
                if (!aState) {
                  continue; // Try next matchup
                }

                // Check maxGamesPerWeek cap for both teams (hard limit if set)
                const divConfig = this.divisionConfigs.get(divisionId);
                const maxGamesPerWeek = divConfig?.maxGamesPerWeek;
                const homeGamesThisWeek = hState.eventsPerWeek.get(week.weekNumber)?.games || 0;
                const awayGamesThisWeek = aState.eventsPerWeek.get(week.weekNumber)?.games || 0;

                if (maxGamesPerWeek != null) {
                  if (homeGamesThisWeek >= maxGamesPerWeek || awayGamesThisWeek >= maxGamesPerWeek) {
                    continue; // Try next matchup - one of the teams is at max cap
                  }
                }

                // Found a valid matchup to schedule!
                scheduledMatchup = matchup;
                scheduledMatchupIndex = matchupIndex;
                bestCandidate = candidate;
                homeTeamState = hState;
                awayTeamState = aState;
                break; // Use the first valid matchup (best by fairness)
              }

              if (!scheduledMatchup || !bestCandidate || !homeTeamState || !awayTeamState) {
                continue; // Try next day in the tier
              }

              // Remove the scheduled matchup from queue
              queue.splice(scheduledMatchupIndex, 1);
              const matchup = scheduledMatchup;

              const eventDraft = candidateToEventDraft(bestCandidate, divisionId);
              this.scheduledEvents.push(eventDraft);
              addEventToContext(this.scoringContext!, eventDraft);

              // Update team states
              updateTeamStateAfterScheduling(homeTeamState, eventDraft, week.weekNumber, true, awayTeamState.teamId, false);
              updateTeamStateAfterScheduling(awayTeamState, eventDraft, week.weekNumber, false, homeTeamState.teamId, false);

              // Update game tracking for fairness at this priority level
              const priorityTracker = gamesPerTeamByPriority.get(priorityName)!;
              priorityTracker.set(matchup.homeTeamId, (priorityTracker.get(matchup.homeTeamId) || 0) + 1);
              priorityTracker.set(matchup.awayTeamId, (priorityTracker.get(matchup.awayTeamId) || 0) + 1);

              // Update resource usage
              updateResourceUsage(this.scoringContext!, bestCandidate.resourceId, bestCandidate.date, totalGameSlotHours);

              // Record budget usage
              recordRequiredDayUsage(divisionId, dayOfWeek, weekNum, requiredDayBudgetTracker, this.divisionNames);

              // Mark matchup as scheduled
              const matchupKey = ScheduleGenerator.createMatchupKey(matchup.homeTeamId, matchup.awayTeamId, matchup.targetWeek);
              scheduledMatchupKeys.add(matchupKey);

              // Log
              const homeTeam = divData.teams.find((t) => t.id === matchup.homeTeamId);
              const awayTeam = divData.teams.find((t) => t.id === matchup.awayTeamId);
              console.log(
                `[Interleaved] ${divName}: ${homeTeam?.name || matchup.homeTeamId} vs ${awayTeam?.name || matchup.awayTeamId} ` +
                `→ ${bestCandidate.date} ${bestCandidate.startTime} @ ${bestCandidate.resourceName}`
              );

              scheduledThisTier++;
              scheduled = true; // Break out of day loop
              continueScheduling = true; // Keep going, we scheduled something
            } // end for each day in tier

            if (scheduled) {
              // This division scheduled a game, continue to next division
            }
          } // end for each division
        } // end while continueScheduling

        if (scheduledThisTier > 0) {
          console.log(`[Interleaved] Week ${weekNum + 1} ${priorityName}: scheduled ${scheduledThisTier} games`);
        }

        // After required/preferred tiers, mark unscheduled current-week matchups as overflow
        // These get priority in the next tier (preferred/acceptable)
        if (priorityName === 'required' || priorityName === 'preferred') {
          for (const divisionId of divisionList) {
            const queue = divisionMatchupQueues.get(divisionId);
            if (!queue) continue;

            for (const matchup of queue) {
              // Only consider matchups targeted for this week
              if (matchup.targetWeek !== weekNum) continue;

              const key = ScheduleGenerator.createMatchupKey(matchup.homeTeamId, matchup.awayTeamId, matchup.targetWeek);
              if (!scheduledMatchupKeys.has(key)) {
                // This matchup couldn't be scheduled on higher-priority days - mark as overflow
                overflowMatchups.add(key);
              }
            }
          }

          if (overflowMatchups.size > 0) {
            console.log(`[Interleaved] Week ${weekNum + 1} after ${priorityName}: ${overflowMatchups.size} matchups marked as overflow for lower-priority days`);
          }
        }
      } // end for each priority level
    } // end for each week

    // Log final game distribution by priority level
    console.log(`\n[Interleaved] Final game distribution by priority level after pre-pass:`);
    for (const priority of ['required', 'preferred', 'acceptable']) {
      const priorityMap = gamesPerTeamByPriority.get(priority)!;
      const hasGames = [...priorityMap.values()].some(v => v > 0);
      if (!hasGames) continue;

      console.log(`  ${priority.toUpperCase()} days:`);
      for (const div of divisionMatchupsList) {
        const divName = this.divisionNames.get(div.divisionId) || div.divisionId;
        const teamCounts = div.teams.map(t => {
          const count = priorityMap.get(t.id) || 0;
          return `${t.name}:${count}`;
        }).join(', ');
        console.log(`    ${divName}: ${teamCounts}`);
      }
    }

    console.log(`[Interleaved] Pre-pass complete. Scheduled ${scheduledMatchupKeys.size} games in interleaved fashion.\n`);
    return scheduledMatchupKeys;
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
      config: { gamesPerWeek: number; gameDurationHours: number; gameArriveBeforeHours?: number; maxGamesPerWeek?: number };
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
    division: { divisionId: string; divisionName: string; config: { gamesPerWeek: number; gameDurationHours: number; gameArriveBeforeHours?: number; maxGamesPerWeek?: number } },
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
   * Rebalance home/away assignments for scheduled games.
   * This runs after scheduling to fix imbalances caused by games that failed to schedule.
   *
   * Strategy:
   * 1. Group scheduled games by team pairing
   * 2. For each pairing with imbalance > 1, swap some games
   * 3. Use overall team balance as secondary consideration
   */
  private rebalanceScheduledHomeAway(): void {
    console.log('  [Rebalancing] Starting home/away rebalance...');
    verboseLog('\n--- Rebalancing Home/Away for Scheduled Games ---');

    // Get only scheduled games (not practices/cages)
    const scheduledGames = this.scheduledEvents.filter(e => e.eventType === 'game');

    if (scheduledGames.length === 0) {
      console.log('  [Rebalancing] No games to rebalance');
      verboseLog('  No games to rebalance');
      return;
    }
    console.log(`  [Rebalancing] Found ${scheduledGames.length} games to check`);

    // Helper to create a canonical key for a team pairing
    // Use | as delimiter since team IDs contain hyphens
    const getPairingKey = (teamA: string, teamB: string): string => {
      return teamA < teamB ? `${teamA}|${teamB}` : `${teamB}|${teamA}`;
    };

    // Group games by team pairing
    const gamesByPair = new Map<string, typeof scheduledGames>();
    for (const game of scheduledGames) {
      if (!game.homeTeamId || !game.awayTeamId) continue;
      const key = getPairingKey(game.homeTeamId, game.awayTeamId);
      if (!gamesByPair.has(key)) {
        gamesByPair.set(key, []);
      }
      gamesByPair.get(key)!.push(game);
    }

    // Track overall team home/away counts
    const teamHomeCount = new Map<string, number>();
    const teamAwayCount = new Map<string, number>();

    for (const game of scheduledGames) {
      if (!game.homeTeamId || !game.awayTeamId) continue;
      teamHomeCount.set(game.homeTeamId, (teamHomeCount.get(game.homeTeamId) || 0) + 1);
      teamAwayCount.set(game.awayTeamId, (teamAwayCount.get(game.awayTeamId) || 0) + 1);
    }

    // Log initial state
    verboseLog('  Initial per-pairing balance:');
    let initialPairingIssues = 0;
    for (const [key, games] of gamesByPair) {
      const [teamA, teamB] = key.split('|');
      const teamAHome = games.filter(g => g.homeTeamId === teamA).length;
      const teamBHome = games.filter(g => g.homeTeamId === teamB).length;
      const diff = Math.abs(teamAHome - teamBHome);
      if (diff > 1) {
        initialPairingIssues++;
        verboseLog(`    ${key}: ${teamA} home ${teamAHome}x, ${teamB} home ${teamBHome}x (imbalanced)`);
      }
    }

    if (initialPairingIssues === 0) {
      console.log('  [Rebalancing] All pairings already balanced (no diff > 1)');
      verboseLog('  All pairings already balanced');
      // Don't return - still need to check overall team balance in Phase 2
    } else {
      console.log(`  [Rebalancing] Found ${initialPairingIssues} imbalanced pairings (diff > 1), rebalancing...`);
      verboseLog(`  Found ${initialPairingIssues} imbalanced pairings, rebalancing...`);
    }

    // Rebalance each pairing (Phase 1 - only fix actual problems)
    // Only swap if:
    // 1. The pairing itself is imbalanced (diff > 1), OR
    // 2. One team has overall imbalance AND swapping would help without hurting the other team
    let swapsMade = 0;
    for (const [key, games] of gamesByPair) {
      const [teamA, teamB] = key.split('|');
      const teamAGames = games.filter(g => g.homeTeamId === teamA);
      const teamBGames = games.filter(g => g.homeTeamId === teamB);

      const teamAHome = teamAGames.length;
      const teamBHome = teamBGames.length;
      const totalGames = games.length;
      const pairingDiff = Math.abs(teamAHome - teamBHome);

      // Get current overall imbalances
      const teamAOverallHome = teamHomeCount.get(teamA) || 0;
      const teamBOverallHome = teamHomeCount.get(teamB) || 0;
      const teamAOverallAway = teamAwayCount.get(teamA) || 0;
      const teamBOverallAway = teamAwayCount.get(teamB) || 0;
      const teamAImbalance = teamAOverallHome - teamAOverallAway;
      const teamBImbalance = teamBOverallHome - teamBOverallAway;

      // Skip if pairing is already balanced AND both teams have acceptable overall balance
      if (pairingDiff <= 1 && Math.abs(teamAImbalance) <= 1 && Math.abs(teamBImbalance) <= 1) {
        continue; // Nothing to fix here
      }

      // Calculate targets - only for pairings that need fixing
      const idealEach = Math.floor(totalGames / 2);
      let targetAHome = idealEach;
      let targetBHome = idealEach;

      if (totalGames % 2 === 1) {
        // Give the extra home game to the team with worse imbalance (fewer home games)
        if (teamAImbalance < teamBImbalance) {
          targetAHome = idealEach + 1;
        } else if (teamBImbalance < teamAImbalance) {
          targetBHome = idealEach + 1;
        } else {
          // Both have same imbalance - keep current distribution if pairing is balanced
          if (pairingDiff <= 1) {
            // Keep whoever currently has the extra
            if (teamAHome > teamBHome) {
              targetAHome = idealEach + 1;
            } else {
              targetBHome = idealEach + 1;
            }
          } else {
            // Pairing is imbalanced - give extra to alphabetically first (deterministic)
            targetAHome = idealEach + 1;
          }
        }
      }

      // Swap games if needed
      while (teamAGames.length > targetAHome && teamBGames.length < targetBHome) {
        // Swap a game from teamA home to teamB home
        const gameToSwap = teamAGames.pop()!;
        const temp = gameToSwap.homeTeamId;
        gameToSwap.homeTeamId = gameToSwap.awayTeamId;
        gameToSwap.awayTeamId = temp;
        teamBGames.push(gameToSwap);

        // Update overall counts
        teamHomeCount.set(teamA, (teamHomeCount.get(teamA) || 0) - 1);
        teamAwayCount.set(teamA, (teamAwayCount.get(teamA) || 0) + 1);
        teamHomeCount.set(teamB, (teamHomeCount.get(teamB) || 0) + 1);
        teamAwayCount.set(teamB, (teamAwayCount.get(teamB) || 0) - 1);

        swapsMade++;
      }

      while (teamBGames.length > targetBHome && teamAGames.length < targetAHome) {
        // Swap a game from teamB home to teamA home
        const gameToSwap = teamBGames.pop()!;
        const temp = gameToSwap.homeTeamId;
        gameToSwap.homeTeamId = gameToSwap.awayTeamId;
        gameToSwap.awayTeamId = temp;
        teamAGames.push(gameToSwap);

        // Update overall counts
        teamHomeCount.set(teamB, (teamHomeCount.get(teamB) || 0) - 1);
        teamAwayCount.set(teamB, (teamAwayCount.get(teamB) || 0) + 1);
        teamHomeCount.set(teamA, (teamHomeCount.get(teamA) || 0) + 1);
        teamAwayCount.set(teamA, (teamAwayCount.get(teamA) || 0) - 1);

        swapsMade++;
      }
    }

    // Log final state
    console.log(`  [Rebalancing] Made ${swapsMade} home/away swaps`);
    verboseLog(`  Made ${swapsMade} home/away swaps`);

    // Verify final balance
    let finalPairingIssues = 0;
    for (const [key, games] of gamesByPair) {
      const [teamA] = key.split('|');
      const teamAHome = games.filter(g => g.homeTeamId === teamA).length;
      const teamBHome = games.length - teamAHome;
      const diff = Math.abs(teamAHome - teamBHome);
      if (diff > 1) {
        finalPairingIssues++;
      }
    }

    verboseLog(`  Final pairing issues: ${finalPairingIssues}`);

    // Recalculate team home/away counts after per-pairing rebalancing
    teamHomeCount.clear();
    teamAwayCount.clear();
    for (const game of scheduledGames) {
      if (!game.homeTeamId || !game.awayTeamId) continue;
      teamHomeCount.set(game.homeTeamId, (teamHomeCount.get(game.homeTeamId) || 0) + 1);
      teamAwayCount.set(game.awayTeamId, (teamAwayCount.get(game.awayTeamId) || 0) + 1);
    }

    // Phase 2: Fix overall team balance
    // A team passes if |homeGames - awayGames| <= 1
    // To fix imbalanced teams, we need to swap games where:
    // 1. The swap doesn't break per-pairing balance (diff stays <= 1)
    // 2. The swap improves overall balance for the imbalanced team
    console.log('  [Rebalancing] Phase 2: Fixing overall team balance...');

    const getTeamImbalance = (teamId: string): number => {
      return (teamHomeCount.get(teamId) || 0) - (teamAwayCount.get(teamId) || 0);
    };

    // Find teams with overall imbalance > 1
    const imbalancedTeams: Array<{ teamId: string; imbalance: number }> = [];
    const allTeamIds = new Set<string>();
    for (const game of scheduledGames) {
      if (game.homeTeamId) allTeamIds.add(game.homeTeamId);
      if (game.awayTeamId) allTeamIds.add(game.awayTeamId);
    }

    for (const teamId of allTeamIds) {
      const imbalance = getTeamImbalance(teamId);
      if (Math.abs(imbalance) > 1) {
        imbalancedTeams.push({ teamId, imbalance });
      }
    }

    // Log ALL teams after recalculation to see the full picture
    console.log('  [Rebalancing] All teams after Phase 1:');
    for (const teamId of allTeamIds) {
      const teamState = this.teamSchedulingStates.get(teamId);
      const teamName = teamState?.teamName || teamId;
      const divSuffix = teamState?.divisionId?.slice(-8) || '?';
      const home = teamHomeCount.get(teamId) || 0;
      const away = teamAwayCount.get(teamId) || 0;
      const diff = Math.abs(home - away);
      const status = diff > 1 ? '⚠' : '✓';
      console.log(`    ${teamName} (${divSuffix}): ${home} home, ${away} away (diff: ${diff}) ${status}`);
    }

    if (imbalancedTeams.length === 0) {
      console.log('  [Rebalancing] All teams already have balanced overall home/away');
    } else {
      console.log(`  [Rebalancing] Found ${imbalancedTeams.length} teams with overall imbalance > 1:`);
      for (const { teamId, imbalance } of imbalancedTeams) {
        const teamState = this.teamSchedulingStates.get(teamId);
        const teamName = teamState?.teamName || teamId;
        const home = teamHomeCount.get(teamId) || 0;
        const away = teamAwayCount.get(teamId) || 0;
        console.log(`    ${teamName} (${teamState?.divisionId?.slice(-8) || '?'}): ${home} home, ${away} away (imbalance: ${imbalance})`);
      }

      let overallSwaps = 0;
      const maxPasses = 10; // Prevent infinite loops
      // Track swapped games to prevent swapping them back (which would create infinite loops)
      const swappedGames = new Set<ScheduledEventDraft>();

      // Multi-pass: keep iterating until no more swaps can be made
      // Swapping to fix one team can create imbalance in another, so we need multiple passes
      for (let pass = 0; pass < maxPasses; pass++) {
        let passSwaps = 0;

        // Re-find imbalanced teams at the start of each pass
        const currentImbalanced: Array<{ teamId: string; imbalance: number }> = [];
        for (const teamId of allTeamIds) {
          const imbalance = getTeamImbalance(teamId);
          if (Math.abs(imbalance) > 1) {
            currentImbalanced.push({ teamId, imbalance });
          }
        }

        if (currentImbalanced.length === 0) {
          break; // All teams balanced
        }

        // Sort by absolute imbalance (worst first) to prioritize fixing the most imbalanced teams
        currentImbalanced.sort((a, b) => {
          const diff = Math.abs(b.imbalance) - Math.abs(a.imbalance);
          if (diff !== 0) return diff;
          // Deterministic tiebreaker: sort by team ID
          return a.teamId.localeCompare(b.teamId);
        });

        // For each imbalanced team, try to find a swap that helps without breaking per-pairing balance
        for (const { teamId } of currentImbalanced) {
          const teamState = this.teamSchedulingStates.get(teamId);
          const teamName = teamState?.teamName || teamId;

        // Re-check current imbalance - it may have changed due to previous swaps
        const currentImbalance = getTeamImbalance(teamId);
        if (Math.abs(currentImbalance) <= 1) {
          // Team is now balanced due to earlier swaps, skip
          continue;
        }

        if (currentImbalance > 1) {
          // Team has too many home games - need to swap a home game to away
          // Find a game where this team is home and the opponent has too few home games
          const homeGames = scheduledGames.filter(g => g.homeTeamId === teamId);
          console.log(`    Looking for swaps for ${teamName} (${homeGames.length} home games)...`);

          for (const game of homeGames) {
            if (!game.awayTeamId) continue;
            // Skip games that were already swapped to prevent swap loops
            if (swappedGames.has(game)) continue;

            const opponentId = game.awayTeamId;
            const opponentImbalance = getTeamImbalance(opponentId);
            const opponentState = this.teamSchedulingStates.get(opponentId);
            const opponentName = opponentState?.teamName || opponentId;

            // Check that per-pairing balance isn't broken by this swap
            const pairKey = getPairingKey(teamId, opponentId);
            const pairGames = gamesByPair.get(pairKey) || [];
            const teamHomesInPair = pairGames.filter(g => g.homeTeamId === teamId).length;
            const opponentHomesInPair = pairGames.filter(g => g.homeTeamId === opponentId).length;

            // After swap: teamHomesInPair - 1, opponentHomesInPair + 1
            const newPairDiff = Math.abs((teamHomesInPair - 1) - (opponentHomesInPair + 1));

            // Check if swap would make opponent's overall imbalance unacceptable
            // After swap, opponent gains 1 home and loses 1 away, so imbalance increases by 2
            const opponentNewImbalance = opponentImbalance + 2;

            console.log(`      vs ${opponentName}: oppImbalance=${opponentImbalance}->${opponentNewImbalance}, pairBalance=${teamHomesInPair}-${opponentHomesInPair}, newPairDiff=${newPairDiff}`);

            // Allow swap if:
            // 1. Per-pairing balance stays acceptable (diff <= 1 to preserve head-to-head fairness)
            // 2. Opponent's new imbalance is acceptable (within ±2, relaxed to allow multi-pass fixing)
            // The multi-pass approach will fix any opponent imbalances created by this swap.
            if (newPairDiff <= 1 && Math.abs(opponentNewImbalance) <= 2) {
              // Safe to swap
              const temp = game.homeTeamId;
              game.homeTeamId = game.awayTeamId;
              game.awayTeamId = temp;

              // Update counts
              teamHomeCount.set(teamId, (teamHomeCount.get(teamId) || 0) - 1);
              teamAwayCount.set(teamId, (teamAwayCount.get(teamId) || 0) + 1);
              teamHomeCount.set(opponentId, (teamHomeCount.get(opponentId) || 0) + 1);
              teamAwayCount.set(opponentId, (teamAwayCount.get(opponentId) || 0) - 1);

              overallSwaps++;
              passSwaps++;
              swappedGames.add(game); // Mark as swapped to prevent swap back
              console.log(`      ✓ Swapped: ${teamName} was home, now away (vs ${opponentName})`);
              verboseLog(`    Swapped game: ${teamName} was home, now away (vs ${opponentName})`);

              // Check if this team is now balanced
              if (Math.abs(getTeamImbalance(teamId)) <= 1) {
                break;
              }
            }
          }
        } else if (currentImbalance < -1) {
          // Team has too many away games - need to swap an away game to home
          const awayGames = scheduledGames.filter(g => g.awayTeamId === teamId);

          for (const game of awayGames) {
            if (!game.homeTeamId) continue;
            // Skip games that were already swapped to prevent swap loops
            if (swappedGames.has(game)) continue;

            const opponentId = game.homeTeamId;
            const opponentImbalance = getTeamImbalance(opponentId);
            const opponentState = this.teamSchedulingStates.get(opponentId);
            const opponentName = opponentState?.teamName || opponentId;

            // Check that per-pairing balance isn't broken by this swap
            const pairKey = getPairingKey(teamId, opponentId);
            const pairGames = gamesByPair.get(pairKey) || [];
            const teamHomesInPair = pairGames.filter(g => g.homeTeamId === teamId).length;
            const opponentHomesInPair = pairGames.filter(g => g.homeTeamId === opponentId).length;

            // After swap: teamHomesInPair + 1, opponentHomesInPair - 1
            const newPairDiff = Math.abs((teamHomesInPair + 1) - (opponentHomesInPair - 1));

            // Check if swap would make opponent's overall imbalance unacceptable
            // After swap, opponent loses 1 home and gains 1 away, so imbalance decreases by 2
            const opponentNewImbalance = opponentImbalance - 2;

            console.log(`      vs ${opponentName}: oppImbalance=${opponentImbalance}->${opponentNewImbalance}, pairBalance=${teamHomesInPair}-${opponentHomesInPair}, newPairDiff=${newPairDiff}`);

            // Allow swap if:
            // 1. Per-pairing balance stays acceptable (diff <= 1 to preserve head-to-head fairness)
            // 2. Opponent's new imbalance is acceptable (within ±2, relaxed to allow multi-pass fixing)
            // The multi-pass approach will fix any opponent imbalances created by this swap.
            if (newPairDiff <= 1 && Math.abs(opponentNewImbalance) <= 2) {
              // Safe to swap
              const temp = game.homeTeamId;
              game.homeTeamId = game.awayTeamId;
              game.awayTeamId = temp;

              // Update counts
              teamHomeCount.set(teamId, (teamHomeCount.get(teamId) || 0) + 1);
              teamAwayCount.set(teamId, (teamAwayCount.get(teamId) || 0) - 1);
              teamHomeCount.set(opponentId, (teamHomeCount.get(opponentId) || 0) - 1);
              teamAwayCount.set(opponentId, (teamAwayCount.get(opponentId) || 0) + 1);

              overallSwaps++;
              passSwaps++;
              swappedGames.add(game); // Mark as swapped to prevent swap back
              console.log(`      ✓ Swapped: ${teamName} was away, now home (vs ${opponentName})`);
              verboseLog(`    Swapped game: ${teamName} was away, now home (vs ${opponentName})`);

              // Check if this team is now balanced
              if (Math.abs(getTeamImbalance(teamId)) <= 1) {
                break;
              }
            }
          }
        }
        }

        // If no swaps were made this pass, we've reached a stable state
        if (passSwaps === 0) {
          break;
        }

        console.log(`    [Pass ${pass + 1}] Made ${passSwaps} swaps, continuing...`);
      }

      console.log(`  [Rebalancing] Made ${overallSwaps} overall balance swaps`);
    }

    // Log final team balance
    console.log('  [Rebalancing] Final per-team balance:');
    verboseLog('  Final per-team balance:');

    let teamsWithImbalance = 0;
    for (const teamId of allTeamIds) {
      const home = teamHomeCount.get(teamId) || 0;
      const away = teamAwayCount.get(teamId) || 0;
      const diff = Math.abs(home - away);
      const status = diff <= 1 ? '✓' : (diff <= 2 ? '~' : '⚠');
      const teamState = this.teamSchedulingStates.get(teamId);
      const teamName = teamState?.teamName || teamId;
      const divSuffix = teamState?.divisionId?.slice(-8) || '?';
      if (diff > 1) {
        teamsWithImbalance++;
        console.log(`    ${teamName} (${divSuffix}): ${home} home, ${away} away (diff: ${diff}) ${status}`);
      }
      verboseLog(`    ${teamName} (${divSuffix}): ${home} home, ${away} away (diff: ${diff}) ${status}`);
    }

    if (teamsWithImbalance === 0) {
      console.log('    All teams balanced (diff <= 1)');
    }
  }

  /**
   * Rebalance short rest (games scheduled ≤2 days apart) across teams within each division.
   * This is a post-scheduling optimization that swaps game dates within the same week
   * to reduce the delta (max - min) of short rest violations per team.
   */
  private rebalanceShortRest(): void {
    console.log('  [ShortRest] Starting short rest balance optimization...');

    // Get all scheduled games
    const scheduledGames = this.scheduledEvents.filter(e => e.eventType === 'game');
    if (scheduledGames.length === 0) {
      console.log('  [ShortRest] No games to optimize');
      return;
    }

    // Pre-compute indexes for fast lookups (computed once, used many times)
    // Index: date+teamId -> count of field events (games/practices)
    const teamDateEventCount = new Map<string, number>();
    for (const e of this.scheduledEvents) {
      if (e.eventType === 'game' || e.eventType === 'practice') {
        if (e.homeTeamId) {
          const key = `${e.date}|${e.homeTeamId}`;
          teamDateEventCount.set(key, (teamDateEventCount.get(key) || 0) + 1);
        }
        if (e.awayTeamId) {
          const key = `${e.date}|${e.awayTeamId}`;
          teamDateEventCount.set(key, (teamDateEventCount.get(key) || 0) + 1);
        }
        if (e.teamId) {
          const key = `${e.date}|${e.teamId}`;
          teamDateEventCount.set(key, (teamDateEventCount.get(key) || 0) + 1);
        }
      }
    }

    // Index: fieldId+date -> list of games (for field conflict check)
    const gamesByFieldDate = new Map<string, Array<{ startTime: string; endTime: string; game: typeof scheduledGames[0] }>>();
    for (const game of scheduledGames) {
      if (game.fieldId) {
        const key = `${game.fieldId}|${game.date}`;
        if (!gamesByFieldDate.has(key)) gamesByFieldDate.set(key, []);
        gamesByFieldDate.get(key)!.push({ startTime: game.startTime, endTime: game.endTime, game });
      }
    }

    // Group games by division
    const gamesByDivision = new Map<string, typeof scheduledGames>();
    for (const game of scheduledGames) {
      if (!gamesByDivision.has(game.divisionId)) {
        gamesByDivision.set(game.divisionId, []);
      }
      gamesByDivision.get(game.divisionId)!.push(game);
    }

    // Process each division
    for (const [divisionId, divisionGames] of gamesByDivision) {
      const divisionName = this.divisionNames.get(divisionId) || divisionId.slice(-8);

      // Calculate short rest violations per team
      const calculateViolations = (): Map<string, number> => {
        const teamGameDates = new Map<string, string[]>();

        for (const game of divisionGames) {
          if (game.homeTeamId) {
            if (!teamGameDates.has(game.homeTeamId)) teamGameDates.set(game.homeTeamId, []);
            teamGameDates.get(game.homeTeamId)!.push(game.date);
          }
          if (game.awayTeamId) {
            if (!teamGameDates.has(game.awayTeamId)) teamGameDates.set(game.awayTeamId, []);
            teamGameDates.get(game.awayTeamId)!.push(game.date);
          }
        }

        const violations = new Map<string, number>();
        for (const [teamId, dates] of teamGameDates) {
          const sortedDates = [...new Set(dates)].sort();
          let count = 0;
          for (let i = 1; i < sortedDates.length; i++) {
            const d1 = new Date(sortedDates[i - 1]);
            const d2 = new Date(sortedDates[i]);
            const gap = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
            if (gap <= 2) count++;
          }
          violations.set(teamId, count);
        }
        return violations;
      };

      const getDelta = (violations: Map<string, number>): number => {
        const counts = Array.from(violations.values());
        if (counts.length === 0) return 0;
        return Math.max(...counts) - Math.min(...counts);
      };

      const getMaxMin = (violations: Map<string, number>): { max: number; min: number } => {
        const counts = Array.from(violations.values());
        if (counts.length === 0) return { max: 0, min: 0 };
        return { max: Math.max(...counts), min: Math.min(...counts) };
      };

      let violations = calculateViolations();
      let delta = getDelta(violations);

      if (delta <= 1) {
        verboseLog(`  [ShortRest] ${divisionName}: delta=${delta}, no optimization needed`);
        continue;
      }

      // Log initial violations per team
      const initialViolationsList = Array.from(violations.entries())
        .map(([teamId, count]) => {
          const state = this.teamSchedulingStates.get(teamId);
          return `${state?.teamName || teamId}:${count}`;
        })
        .join(', ');
      console.log(`  [ShortRest] ${divisionName}: initial delta=${delta} [${initialViolationsList}]`);

      // Try to find beneficial swaps - try ALL pairs of games on different days
      // First try within-week swaps, then expand to cross-week if needed
      let swapsMade = 0;
      const maxIterations = 30; // Prevent infinite loops
      let totalPairsChecked = 0;
      let sameDayConflicts = 0;
      let maxGamesPerWeekBlocks = 0;
      let matchupSpacingBlocks = 0;
      let fieldConflictBlocks = 0;
      let noImprovementCount = 0;
      // Track swapped game pairs to prevent oscillation (e.g., A<->B then B<->A)
      const swappedPairs = new Set<string>();

      for (let iter = 0; iter < maxIterations && delta > 1; iter++) {
        let foundImprovement = false;

        // Try all pairs of games on different days (including cross-week swaps)
        for (let i = 0; i < divisionGames.length && !foundImprovement; i++) {
          for (let j = i + 1; j < divisionGames.length && !foundImprovement; j++) {
              const game1 = divisionGames[i];
              const game2 = divisionGames[j];

              // Skip if same day (nothing to swap)
              if (game1.date === game2.date) continue;

              totalPairsChecked++;

              // Skip pairs that have already been swapped (prevents oscillation)
              const pairKey = i < j ? `${i}-${j}` : `${j}-${i}`;
              if (swappedPairs.has(pairKey)) continue;

              const teams1 = [game1.homeTeamId, game1.awayTeamId].filter(Boolean) as string[];
              const teams2 = [game2.homeTeamId, game2.awayTeamId].filter(Boolean) as string[];

              // Check if swap would create same-day conflicts using pre-computed count index
              // For each team, check if they'd have more than 1 event on the target date after swap
              let wouldCreateSameDayConflict = false;
              for (const teamId of teams1) {
                // Team in game1 is moving to game2.date
                const key = `${game2.date}|${teamId}`;
                const count = teamDateEventCount.get(key) || 0;
                const game2InvolvesTeam = teams2.includes(teamId);
                // After swap: if team in both games, count stays same; if only in game1, count +1
                const afterCount = game2InvolvesTeam ? count : count + 1;
                if (afterCount > 1) {
                  wouldCreateSameDayConflict = true;
                  break;
                }
              }
              if (!wouldCreateSameDayConflict) {
                for (const teamId of teams2) {
                  // Team in game2 is moving to game1.date
                  const key = `${game1.date}|${teamId}`;
                  const count = teamDateEventCount.get(key) || 0;
                  const game1InvolvesTeam = teams1.includes(teamId);
                  // After swap: if team in both games, count stays same; if only in game2, count +1
                  const afterCount = game1InvolvesTeam ? count : count + 1;
                  if (afterCount > 1) {
                    wouldCreateSameDayConflict = true;
                    break;
                  }
                }
              }

              if (wouldCreateSameDayConflict) {
                sameDayConflicts++;
                continue;
              }

              // Check if swap would violate maxGamesPerWeek for any team
              const config = this.divisionConfigs.get(divisionId);
              const maxGamesPerWeek = config?.maxGamesPerWeek;
              if (maxGamesPerWeek != null) {
                // Use proper week definitions to match scheduler's week calculation
                const week1 = getWeekNumberForDate(game1.date, this.weekDefinitions);
                const week2 = getWeekNumberForDate(game2.date, this.weekDefinitions);

                // Only need to check if swapping across weeks
                if (week1 !== week2) {
                  // Count games per team per week (excluding both swapped games)
                  const countGamesInWeek = (teamId: string, weekNum: number): number => {
                    return divisionGames.filter(g =>
                      g !== game1 && g !== game2 &&
                      getWeekNumberForDate(g.date, this.weekDefinitions) === weekNum &&
                      (g.homeTeamId === teamId || g.awayTeamId === teamId)
                    ).length;
                  };

                  let wouldExceedMaxGames = false;
                  // Check teams from game1 moving to week2
                  for (const teamId of teams1) {
                    // Base count excludes both swapped games
                    let gamesInWeek2 = countGamesInWeek(teamId, week2);
                    // Add 1 for game1 arriving in week2
                    gamesInWeek2 += 1;
                    // If this team is also in game2, game2 is leaving week2, so no additional change
                    // (it's already excluded from count)
                    if (gamesInWeek2 > maxGamesPerWeek) {
                      wouldExceedMaxGames = true;
                      break;
                    }
                  }
                  // Check teams from game2 moving to week1
                  if (!wouldExceedMaxGames) {
                    for (const teamId of teams2) {
                      // Base count excludes both swapped games
                      let gamesInWeek1 = countGamesInWeek(teamId, week1);
                      // Add 1 for game2 arriving in week1
                      gamesInWeek1 += 1;
                      // If this team is also in game1, game1 is leaving week1, so no additional change
                      // (it's already excluded from count)
                      if (gamesInWeek1 > maxGamesPerWeek) {
                        wouldExceedMaxGames = true;
                        break;
                      }
                    }
                  }

                  if (wouldExceedMaxGames) {
                    maxGamesPerWeekBlocks++;
                    continue;
                  }
                }
              }

              // Check if this would violate matchup spacing (same two teams playing within 7 days)
              const isSameMatchup = (g1: typeof game1, g2: typeof game1): boolean => {
                const teams1Set = new Set([g1.homeTeamId, g1.awayTeamId].filter(Boolean));
                const teams2Set = new Set([g2.homeTeamId, g2.awayTeamId].filter(Boolean));
                if (teams1Set.size !== teams2Set.size) return false;
                for (const t of teams1Set) {
                  if (!teams2Set.has(t)) return false;
                }
                return true;
              };

              const getDayGap = (date1: string, date2: string): number => {
                const d1 = new Date(date1);
                const d2 = new Date(date2);
                return Math.abs(Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
              };

              // After swap: game1 will be on game2's date, game2 will be on game1's date
              // Check if any OTHER game with the same matchup would be too close (< 7 days)
              const wouldViolateMatchupSpacing = (): boolean => {
                for (const otherGame of divisionGames) {
                  if (otherGame === game1 || otherGame === game2) continue;

                  // Check if otherGame has same matchup as game1
                  if (isSameMatchup(game1, otherGame)) {
                    // game1 is moving to game2.date - check gap with otherGame
                    if (getDayGap(game2.date, otherGame.date) < 7) {
                      return true;
                    }
                  }

                  // Check if otherGame has same matchup as game2
                  if (isSameMatchup(game2, otherGame)) {
                    // game2 is moving to game1.date - check gap with otherGame
                    if (getDayGap(game1.date, otherGame.date) < 7) {
                      return true;
                    }
                  }
                }
                return false;
              };

              if (wouldViolateMatchupSpacing()) {
                matchupSpacingBlocks++;
                continue;
              }

              // Check if swap would create field overlap with OTHER divisions' games
              // Using pre-computed index for O(1) lookup instead of O(n) filter
              const wouldCreateFieldConflict = (): boolean => {
                // Check game1's field at game2's date/time
                if (game1.fieldId) {
                  const key = `${game1.fieldId}|${game2.date}`;
                  const gamesOnField = gamesByFieldDate.get(key);
                  if (gamesOnField) {
                    for (const { startTime, endTime, game } of gamesOnField) {
                      if (game !== game1 && game !== game2 &&
                          startTime < game2.endTime && endTime > game2.startTime) {
                        return true;
                      }
                    }
                  }
                }
                // Check game2's field at game1's date/time
                if (game2.fieldId) {
                  const key = `${game2.fieldId}|${game1.date}`;
                  const gamesOnField = gamesByFieldDate.get(key);
                  if (gamesOnField) {
                    for (const { startTime, endTime, game } of gamesOnField) {
                      if (game !== game1 && game !== game2 &&
                          startTime < game1.endTime && endTime > game1.startTime) {
                        return true;
                      }
                    }
                  }
                }
                return false;
              };

              if (wouldCreateFieldConflict()) {
                fieldConflictBlocks++;
                continue;
              }

              // Try the swap
              const orig1Date = game1.date;
              const orig1Time = game1.startTime;
              const orig1EndTime = game1.endTime;
              const orig2Date = game2.date;
              const orig2Time = game2.startTime;
              const orig2EndTime = game2.endTime;

              game1.date = orig2Date;
              game1.startTime = orig2Time;
              game1.endTime = orig2EndTime;
              game2.date = orig1Date;
              game2.startTime = orig1Time;
              game2.endTime = orig1EndTime;

              // Recalculate violations
              const newViolations = calculateViolations();
              const newDelta = getDelta(newViolations);
              const oldMaxMin = getMaxMin(violations);
              const newMaxMin = getMaxMin(newViolations);

              // Accept swap if:
              // 1. Delta decreases (primary goal), OR
              // 2. Delta stays same but max decreases (balancing move), OR
              // 3. Delta stays same but min increases (balancing move)
              const isDeltaImprovement = newDelta < delta;
              const isBalancingMove = newDelta === delta && (
                newMaxMin.max < oldMaxMin.max || newMaxMin.min > oldMaxMin.min
              );

              if (isDeltaImprovement || isBalancingMove) {
                // Record this swap to prevent oscillation
                swappedPairs.add(pairKey);

                // Keep the swap - update the teamDateEventCount index
                for (const teamId of teams1) {
                  // Decrement count at old date, increment at new date
                  const oldKey = `${orig1Date}|${teamId}`;
                  const newKey = `${orig2Date}|${teamId}`;
                  teamDateEventCount.set(oldKey, (teamDateEventCount.get(oldKey) || 1) - 1);
                  teamDateEventCount.set(newKey, (teamDateEventCount.get(newKey) || 0) + 1);
                }
                for (const teamId of teams2) {
                  const oldKey = `${orig2Date}|${teamId}`;
                  const newKey = `${orig1Date}|${teamId}`;
                  teamDateEventCount.set(oldKey, (teamDateEventCount.get(oldKey) || 1) - 1);
                  teamDateEventCount.set(newKey, (teamDateEventCount.get(newKey) || 0) + 1);
                }

                const teams1Names = teams1.map(t => {
                  const state = this.teamSchedulingStates.get(t);
                  return state?.teamName || t;
                }).join(' vs ');
                const teams2Names = teams2.map(t => {
                  const state = this.teamSchedulingStates.get(t);
                  return state?.teamName || t;
                }).join(' vs ');

                if (isDeltaImprovement) {
                  console.log(`  [ShortRest] ${divisionName}: swapped ${teams1Names} (was ${orig1Date}) with ${teams2Names} (was ${orig2Date}), delta ${delta}->${newDelta}`);
                } else {
                  console.log(`  [ShortRest] ${divisionName}: balancing swap ${teams1Names} (was ${orig1Date}) with ${teams2Names} (was ${orig2Date}), max ${oldMaxMin.max}->${newMaxMin.max}, min ${oldMaxMin.min}->${newMaxMin.min}`);
                }

                violations = newViolations;
                delta = newDelta;
                swapsMade++;
                foundImprovement = true;
              } else {
                // Revert the swap
                noImprovementCount++;
                game1.date = orig1Date;
                game1.startTime = orig1Time;
                game1.endTime = orig1EndTime;
                game2.date = orig2Date;
                game2.startTime = orig2Time;
                game2.endTime = orig2EndTime;
              }
          }
        }

        if (!foundImprovement) break;
      }

      // Log diagnostic info if delta > 1
      if (delta > 1) {
        console.log(`  [ShortRest] ${divisionName}: checked ${totalPairsChecked} pairs, blocked by: sameDay=${sameDayConflicts}, maxGames=${maxGamesPerWeekBlocks}, matchupSpacing=${matchupSpacingBlocks}, fieldConflict=${fieldConflictBlocks}, noImprove=${noImprovementCount}`);
      }

      // Log final state for this division
      const finalViolations = Array.from(violations.entries())
        .map(([teamId, count]) => {
          const state = this.teamSchedulingStates.get(teamId);
          return `${state?.teamName || teamId}:${count}`;
        })
        .join(', ');

      if (swapsMade > 0) {
        console.log(`  [ShortRest] ${divisionName}: made ${swapsMade} swap(s), final delta=${delta} [${finalViolations}]`);
      } else {
        console.log(`  [ShortRest] ${divisionName}: no beneficial swaps found, delta=${delta} [${finalViolations}]`);
      }
    }

    // VALIDATION: Check for any same-day field event conflicts after all swaps
    const allGames = this.scheduledEvents.filter(e => e.eventType === 'game');
    const teamEventsByDate = new Map<string, Map<string, number>>();
    for (const game of allGames) {
      for (const teamId of [game.homeTeamId, game.awayTeamId]) {
        if (!teamId) continue;
        if (!teamEventsByDate.has(teamId)) {
          teamEventsByDate.set(teamId, new Map());
        }
        const dateMap = teamEventsByDate.get(teamId)!;
        dateMap.set(game.date, (dateMap.get(game.date) || 0) + 1);
      }
    }
    for (const [teamId, dateMap] of teamEventsByDate) {
      for (const [date, count] of dateMap) {
        if (count > 1) {
          const teamState = this.teamSchedulingStates.get(teamId);
          console.error(`  [ShortRest] ERROR: ${teamState?.teamName || teamId} has ${count} games on ${date} after rebalancing!`);
        }
      }
    }
  }

  /**
   * Rebalance matchup spacing - avoid same teams playing within 7 days.
   * This is a post-scheduling optimization that swaps game dates to increase
   * the gap between repeated matchups (same two teams playing each other).
   */
  private rebalanceMatchupSpacing(): void {
    console.log('  [MatchupSpacing] Starting matchup spacing optimization...');

    const MIN_MATCHUP_GAP_DAYS = 7;

    // Get all scheduled games
    const scheduledGames = this.scheduledEvents.filter(e => e.eventType === 'game');
    if (scheduledGames.length === 0) {
      console.log('  [MatchupSpacing] No games to optimize');
      return;
    }

    // Pre-compute indexes for fast lookups (computed once, used many times)
    // Index: date+teamId -> has field event
    const teamDateHasFieldEvent = new Set<string>();
    for (const e of this.scheduledEvents) {
      if (e.eventType === 'game' || e.eventType === 'practice') {
        if (e.homeTeamId) teamDateHasFieldEvent.add(`${e.date}|${e.homeTeamId}`);
        if (e.awayTeamId) teamDateHasFieldEvent.add(`${e.date}|${e.awayTeamId}`);
        if (e.teamId) teamDateHasFieldEvent.add(`${e.date}|${e.teamId}`);
      }
    }

    // Index: fieldId+date -> list of games (for field conflict check)
    const gamesByFieldDate = new Map<string, Array<{ startTime: string; endTime: string; game: typeof scheduledGames[0] }>>();
    for (const game of scheduledGames) {
      if (game.fieldId) {
        const key = `${game.fieldId}|${game.date}`;
        if (!gamesByFieldDate.has(key)) gamesByFieldDate.set(key, []);
        gamesByFieldDate.get(key)!.push({ startTime: game.startTime, endTime: game.endTime, game });
      }
    }

    // Group games by division
    const gamesByDivision = new Map<string, typeof scheduledGames>();
    for (const game of scheduledGames) {
      if (!gamesByDivision.has(game.divisionId)) {
        gamesByDivision.set(game.divisionId, []);
      }
      gamesByDivision.get(game.divisionId)!.push(game);
    }

    // Process each division
    for (const [divisionId, divisionGames] of gamesByDivision) {
      const divisionName = this.divisionNames.get(divisionId) || divisionId.slice(-8);

      // Helper to get matchup key (normalized so order doesn't matter)
      const getMatchupKey = (game: (typeof divisionGames)[0]): string => {
        const teams = [game.homeTeamId, game.awayTeamId].filter(Boolean).sort();
        return teams.join('|');
      };

      // Helper to calculate day gap between two dates
      const getDayGap = (date1: string, date2: string): number => {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        return Math.abs(Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
      };

      // Group games by matchup
      const gamesByMatchup = new Map<string, typeof divisionGames>();
      for (const game of divisionGames) {
        const key = getMatchupKey(game);
        if (!gamesByMatchup.has(key)) {
          gamesByMatchup.set(key, []);
        }
        gamesByMatchup.get(key)!.push(game);
      }

      // Find matchups with violations (gaps < MIN_MATCHUP_GAP_DAYS)
      const findViolations = (): Array<{ matchupKey: string; games: typeof divisionGames; minGap: number }> => {
        const violations: Array<{ matchupKey: string; games: typeof divisionGames; minGap: number }> = [];
        for (const [matchupKey, games] of gamesByMatchup) {
          if (games.length < 2) continue;
          const sortedGames = [...games].sort((a, b) => {
            const dateDiff = a.date.localeCompare(b.date);
            if (dateDiff !== 0) return dateDiff;
            // Deterministic tiebreaker: sort by start time, then field ID
            const timeDiff = a.startTime.localeCompare(b.startTime);
            if (timeDiff !== 0) return timeDiff;
            return (a.fieldId || '').localeCompare(b.fieldId || '');
          });
          let minGap = Infinity;
          for (let i = 1; i < sortedGames.length; i++) {
            const gap = getDayGap(sortedGames[i - 1].date, sortedGames[i].date);
            minGap = Math.min(minGap, gap);
          }
          if (minGap < MIN_MATCHUP_GAP_DAYS) {
            violations.push({ matchupKey, games: sortedGames, minGap });
          }
        }
        return violations.sort((a, b) => {
          const gapDiff = a.minGap - b.minGap; // Worst violations first
          if (gapDiff !== 0) return gapDiff;
          // Deterministic tiebreaker: sort by matchup key
          return a.matchupKey.localeCompare(b.matchupKey);
        });
      };

      let violations = findViolations();
      if (violations.length === 0) {
        verboseLog(`  [MatchupSpacing] ${divisionName}: no matchup spacing violations`);
        continue;
      }

      const worstGap = violations[0]?.minGap || 0;
      console.log(`  [MatchupSpacing] ${divisionName}: ${violations.length} matchup(s) with gap < ${MIN_MATCHUP_GAP_DAYS} days (worst: ${worstGap} days)`);
      console.log(`    Matchup details:`);
      for (const v of violations) {
        const teamNames = v.matchupKey.split('|').map(id => {
          const state = this.teamSchedulingStates.get(id);
          return state?.teamName || id.slice(-8);
        }).join(' vs ');
        console.log(`      ${teamNames}: minGap=${v.minGap}, games on ${v.games.map(g => g.date).join(', ')}`);
      }

      // Try to improve spacing through swaps
      let swapsMade = 0;
      let blockedBySameDayConflict = 0;
      let blockedByMaxGamesPerWeek = 0;
      let blockedByConsecutiveMatchup = 0;
      let blockedByNoImprovement = 0;
      const maxIterations = 50;

      for (let iter = 0; iter < maxIterations && violations.length > 0; iter++) {
        let foundImprovement = false;

        // Take the worst violation and try to fix it
        const violation = violations[0];
        const violationGames = violation.games;

        // Try swapping each violation game with other games in the division
        for (const violationGame of violationGames) {
          if (foundImprovement) break;

          for (const otherGame of divisionGames) {
            if (foundImprovement) break;
            if (otherGame === violationGame) continue;
            if (otherGame.date === violationGame.date) continue;

            // Don't swap with another game in the same matchup
            if (getMatchupKey(otherGame) === violation.matchupKey) continue;

            const teams1 = [violationGame.homeTeamId, violationGame.awayTeamId].filter(Boolean) as string[];
            const teams2 = [otherGame.homeTeamId, otherGame.awayTeamId].filter(Boolean) as string[];

            // Check if swap would create same-day conflicts using pre-computed index
            let wouldCreateSameDayConflict = false;
            for (const teamId of teams1) {
              const key = `${otherGame.date}|${teamId}`;
              if (teamDateHasFieldEvent.has(key)) {
                const otherGameInvolvesTeam = teams2.includes(teamId);
                if (!otherGameInvolvesTeam) {
                  wouldCreateSameDayConflict = true;
                  break;
                }
              }
            }
            if (!wouldCreateSameDayConflict) {
              for (const teamId of teams2) {
                const key = `${violationGame.date}|${teamId}`;
                if (teamDateHasFieldEvent.has(key)) {
                  const violationGameInvolvesTeam = teams1.includes(teamId);
                  if (!violationGameInvolvesTeam) {
                    wouldCreateSameDayConflict = true;
                    break;
                  }
                }
              }
            }

            if (wouldCreateSameDayConflict) {
              blockedBySameDayConflict++;
              continue;
            }

            // Check if swap would violate maxGamesPerWeek
            const config = this.divisionConfigs.get(divisionId);
            const maxGamesPerWeek = config?.maxGamesPerWeek;
            if (maxGamesPerWeek !== undefined) {
              // Use proper week definitions to match scheduler's week calculation
              const week1 = getWeekNumberForDate(violationGame.date, this.weekDefinitions);
              const week2 = getWeekNumberForDate(otherGame.date, this.weekDefinitions);

              if (week1 !== week2) {
                const countGamesInWeek = (teamId: string, weekNum: number, excludeGame: typeof violationGame): number => {
                  return divisionGames.filter(g =>
                    g !== excludeGame &&
                    getWeekNumberForDate(g.date, this.weekDefinitions) === weekNum &&
                    (g.homeTeamId === teamId || g.awayTeamId === teamId)
                  ).length;
                };

                let wouldExceedMaxGames = false;
                for (const teamId of teams1) {
                  const gamesInWeek2 = countGamesInWeek(teamId, week2, violationGame);
                  if (gamesInWeek2 + 1 > maxGamesPerWeek) {
                    wouldExceedMaxGames = true;
                    break;
                  }
                }
                if (!wouldExceedMaxGames) {
                  for (const teamId of teams2) {
                    const gamesInWeek1 = countGamesInWeek(teamId, week1, otherGame);
                    if (gamesInWeek1 + 1 > maxGamesPerWeek) {
                      wouldExceedMaxGames = true;
                      break;
                    }
                  }
                }

                if (wouldExceedMaxGames) {
                  blockedByMaxGamesPerWeek++;
                  continue;
                }
              }
            }

            // Check if swap would create consecutive matchups (gap <= 1 day)
            const isSameMatchup = (g1: typeof violationGame, g2: typeof violationGame): boolean => {
              return getMatchupKey(g1) === getMatchupKey(g2);
            };

            const wouldCreateConsecutiveMatchup = (): boolean => {
              for (const game of divisionGames) {
                if (game === violationGame || game === otherGame) continue;

                if (isSameMatchup(violationGame, game)) {
                  if (getDayGap(otherGame.date, game.date) <= 1) return true;
                }
                if (isSameMatchup(otherGame, game)) {
                  if (getDayGap(violationGame.date, game.date) <= 1) return true;
                }
              }
              return false;
            };

            if (wouldCreateConsecutiveMatchup()) {
              blockedByConsecutiveMatchup++;
              continue;
            }

            // Check if swap would hurt short rest balance (games within 2 days)
            const calculateShortRestDelta = (): number => {
              const teamGameDates = new Map<string, string[]>();
              for (const game of divisionGames) {
                if (game.homeTeamId) {
                  if (!teamGameDates.has(game.homeTeamId)) teamGameDates.set(game.homeTeamId, []);
                  teamGameDates.get(game.homeTeamId)!.push(game.date);
                }
                if (game.awayTeamId) {
                  if (!teamGameDates.has(game.awayTeamId)) teamGameDates.set(game.awayTeamId, []);
                  teamGameDates.get(game.awayTeamId)!.push(game.date);
                }
              }

              const violations = new Map<string, number>();
              for (const [teamId, dates] of teamGameDates) {
                const sortedDates = [...new Set(dates)].sort();
                let count = 0;
                for (let i = 1; i < sortedDates.length; i++) {
                  const d1 = new Date(sortedDates[i - 1]);
                  const d2 = new Date(sortedDates[i]);
                  const gap = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
                  if (gap <= 2) count++;
                }
                violations.set(teamId, count);
              }

              const counts = Array.from(violations.values());
              if (counts.length === 0) return 0;
              return Math.max(...counts) - Math.min(...counts);
            };

            const shortRestDeltaBefore = calculateShortRestDelta();

            // Check if swap would create field overlap with OTHER divisions' games
            // Using pre-computed index for O(1) lookup instead of O(n) filter
            const wouldCreateFieldConflict = (): boolean => {
              // Check violationGame's field at otherGame's date/time
              if (violationGame.fieldId) {
                const key = `${violationGame.fieldId}|${otherGame.date}`;
                const gamesOnField = gamesByFieldDate.get(key);
                if (gamesOnField) {
                  for (const { startTime, endTime, game } of gamesOnField) {
                    if (game !== violationGame && game !== otherGame &&
                        startTime < otherGame.endTime && endTime > otherGame.startTime) {
                      return true;
                    }
                  }
                }
              }
              // Check otherGame's field at violationGame's date/time
              if (otherGame.fieldId) {
                const key = `${otherGame.fieldId}|${violationGame.date}`;
                const gamesOnField = gamesByFieldDate.get(key);
                if (gamesOnField) {
                  for (const { startTime, endTime, game } of gamesOnField) {
                    if (game !== violationGame && game !== otherGame &&
                        startTime < violationGame.endTime && endTime > violationGame.startTime) {
                      return true;
                    }
                  }
                }
              }
              return false;
            };

            if (wouldCreateFieldConflict()) {
              continue;
            }

            // Try the swap
            const orig1Date = violationGame.date;
            const orig1Time = violationGame.startTime;
            const orig1EndTime = violationGame.endTime;
            const orig2Date = otherGame.date;
            const orig2Time = otherGame.startTime;
            const orig2EndTime = otherGame.endTime;

            violationGame.date = orig2Date;
            violationGame.startTime = orig2Time;
            violationGame.endTime = orig2EndTime;
            otherGame.date = orig1Date;
            otherGame.startTime = orig1Time;
            otherGame.endTime = orig1EndTime;

            // Check if this improves the matchup spacing
            const newViolations = findViolations();
            const shortRestDeltaAfter = calculateShortRestDelta();

            // Accept the swap if:
            // 1. Matchup spacing improves (fewer violations OR better worst-case gap)
            // 2. AND short rest balance doesn't get worse (delta doesn't increase)
            const violationImproved =
              newViolations.length < violations.length ||
              (newViolations.length === violations.length &&
                newViolations[0]?.minGap > violations[0]?.minGap);

            if (violationImproved && shortRestDeltaAfter <= shortRestDeltaBefore) {
              // Keep the swap
              const teams1Names = teams1.map(t => {
                const state = this.teamSchedulingStates.get(t);
                return state?.teamName || t;
              }).join(' vs ');

              verboseLog(`  [MatchupSpacing] ${divisionName}: swapped ${teams1Names} from ${orig1Date} to ${orig2Date}`);

              violations = newViolations;
              swapsMade++;
              foundImprovement = true;
            } else {
              // Revert the swap
              blockedByNoImprovement++;
              violationGame.date = orig1Date;
              violationGame.startTime = orig1Time;
              violationGame.endTime = orig1EndTime;
              otherGame.date = orig2Date;
              otherGame.startTime = orig2Time;
              otherGame.endTime = orig2EndTime;
            }
          }
        }

        if (!foundImprovement) break;
      }

      if (swapsMade > 0) {
        const newWorstGap = violations[0]?.minGap || 0;
        console.log(`  [MatchupSpacing] ${divisionName}: made ${swapsMade} swap(s), ${violations.length} violations remaining (worst gap now: ${newWorstGap} days)`);
      } else if (violations.length > 0) {
        console.log(`  [MatchupSpacing] ${divisionName}: no beneficial swaps found (${violations.length} violations, worst: ${worstGap} days)`);
      }
      if (blockedBySameDayConflict > 0 || blockedByMaxGamesPerWeek > 0 || blockedByConsecutiveMatchup > 0 || blockedByNoImprovement > 0) {
        console.log(`    Blocked by: sameDayConflict=${blockedBySameDayConflict}, maxGamesPerWeek=${blockedByMaxGamesPerWeek}, consecutiveMatchup=${blockedByConsecutiveMatchup}, noImprovement=${blockedByNoImprovement}`);
      }
    }
  }

  /**
   * Rebuild fieldDatesUsed from actual scheduled events.
   * This is necessary after rebalancing which swaps dates directly on events
   * without updating the team scheduling states.
   */
  private rebuildFieldDatesUsed(): void {
    // Clear all fieldDatesUsed sets
    for (const teamState of this.teamSchedulingStates.values()) {
      teamState.fieldDatesUsed.clear();
    }

    // Rebuild from scheduled events (games and practices use fields)
    for (const event of this.scheduledEvents) {
      if (event.eventType === 'game' || event.eventType === 'practice') {
        const teamIds: string[] = [];
        if (event.teamId) teamIds.push(event.teamId);
        if (event.homeTeamId) teamIds.push(event.homeTeamId);
        if (event.awayTeamId) teamIds.push(event.awayTeamId);

        for (const teamId of teamIds) {
          const teamState = this.teamSchedulingStates.get(teamId);
          if (teamState) {
            teamState.fieldDatesUsed.add(event.date);
          }
        }
      }
    }
  }

  /**
   * Reduce total back-to-back games by swapping game dates within weeks.
   * This is a greedy optimization that tries any swap that reduces back-to-back count.
   */
  private reduceBackToBackGames(scheduledGames: ScheduledEventDraft[]): void {
    console.log('  [BackToBack] Starting back-to-back reduction...');

    // Group games by division
    const gamesByDivision = new Map<string, ScheduledEventDraft[]>();
    for (const game of scheduledGames) {
      if (!gamesByDivision.has(game.divisionId)) {
        gamesByDivision.set(game.divisionId, []);
      }
      gamesByDivision.get(game.divisionId)!.push(game);
    }

    for (const [divisionId, divisionGames] of gamesByDivision) {
      const divisionName = this.divisionNames.get(divisionId) || divisionId.slice(-8);

      // Count back-to-back games (1-day gaps)
      const countBackToBack = (): number => {
        const teamGameDates = new Map<string, string[]>();
        for (const game of divisionGames) {
          if (game.homeTeamId) {
            if (!teamGameDates.has(game.homeTeamId)) teamGameDates.set(game.homeTeamId, []);
            teamGameDates.get(game.homeTeamId)!.push(game.date);
          }
          if (game.awayTeamId) {
            if (!teamGameDates.has(game.awayTeamId)) teamGameDates.set(game.awayTeamId, []);
            teamGameDates.get(game.awayTeamId)!.push(game.date);
          }
        }

        let total = 0;
        for (const dates of teamGameDates.values()) {
          const sortedDates = [...new Set(dates)].sort();
          for (let i = 1; i < sortedDates.length; i++) {
            const d1 = new Date(sortedDates[i - 1]);
            const d2 = new Date(sortedDates[i]);
            const gap = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
            if (gap === 1) total++;
          }
        }
        return total;
      };

      let backToBackCount = countBackToBack();
      if (backToBackCount === 0) {
        verboseLog(`  [BackToBack] ${divisionName}: no back-to-back games`);
        continue;
      }

      const initialCount = backToBackCount;

      // Group games by week for swapping
      const gamesByWeek = new Map<number, ScheduledEventDraft[]>();
      for (const game of divisionGames) {
        const weekNum = this.getWeekNumberForDate(game.date);
        if (!gamesByWeek.has(weekNum)) {
          gamesByWeek.set(weekNum, []);
        }
        gamesByWeek.get(weekNum)!.push(game);
      }

      // Try swaps within each week
      let swapsMade = 0;
      const maxIterations = 30;

      for (let iter = 0; iter < maxIterations && backToBackCount > 0; iter++) {
        let foundImprovement = false;

        for (const [, weekGames] of gamesByWeek) {
          if (weekGames.length < 2) continue;

          // Try all pairs of games on different days
          for (let i = 0; i < weekGames.length && !foundImprovement; i++) {
            for (let j = i + 1; j < weekGames.length && !foundImprovement; j++) {
              const game1 = weekGames[i];
              const game2 = weekGames[j];

              // Skip if same day or same field (can't swap)
              if (game1.date === game2.date) continue;
              if (game1.fieldId !== game2.fieldId) continue;

              // Try swapping dates and times
              const orig1Date = game1.date;
              const orig1Time = game1.startTime;
              const orig1EndTime = game1.endTime;
              const orig2Date = game2.date;
              const orig2Time = game2.startTime;
              const orig2EndTime = game2.endTime;

              // Check if swap would create same-day conflicts
              // Get all teams involved in both games
              const teamsInGame1 = [game1.homeTeamId, game1.awayTeamId].filter(Boolean) as string[];
              const teamsInGame2 = [game2.homeTeamId, game2.awayTeamId].filter(Boolean) as string[];

              // Check if any team in game1 has another game on orig2Date (excluding game1 itself)
              // Check if any team in game2 has another game on orig1Date (excluding game2 itself)
              let wouldCreateSameDayConflict = false;
              for (const teamId of teamsInGame1) {
                // Check if this team has another game on orig2Date (the date game1 would move to)
                const hasOtherGameOnNewDate = divisionGames.some(
                  (g) =>
                    g !== game1 &&
                    g !== game2 &&
                    g.date === orig2Date &&
                    (g.homeTeamId === teamId || g.awayTeamId === teamId)
                );
                if (hasOtherGameOnNewDate) {
                  wouldCreateSameDayConflict = true;
                  break;
                }
              }
              if (!wouldCreateSameDayConflict) {
                for (const teamId of teamsInGame2) {
                  // Check if this team has another game on orig1Date (the date game2 would move to)
                  const hasOtherGameOnNewDate = divisionGames.some(
                    (g) =>
                      g !== game1 &&
                      g !== game2 &&
                      g.date === orig1Date &&
                      (g.homeTeamId === teamId || g.awayTeamId === teamId)
                  );
                  if (hasOtherGameOnNewDate) {
                    wouldCreateSameDayConflict = true;
                    break;
                  }
                }
              }

              // Skip this swap if it would create same-day conflicts
              if (wouldCreateSameDayConflict) continue;

              game1.date = orig2Date;
              game1.startTime = orig2Time;
              game1.endTime = orig2EndTime;
              game2.date = orig1Date;
              game2.startTime = orig1Time;
              game2.endTime = orig1EndTime;

              const newCount = countBackToBack();

              if (newCount < backToBackCount) {
                // Keep the swap
                const teams1 = [game1.homeTeamId, game1.awayTeamId].filter(Boolean).map(t => {
                  const state = this.teamSchedulingStates.get(t!);
                  return state?.teamName || t;
                }).join(' vs ');
                const teams2 = [game2.homeTeamId, game2.awayTeamId].filter(Boolean).map(t => {
                  const state = this.teamSchedulingStates.get(t!);
                  return state?.teamName || t;
                }).join(' vs ');

                verboseLog(`  [BackToBack] ${divisionName}: swapped ${teams1} (was ${orig1Date}) with ${teams2} (was ${orig2Date}), count ${backToBackCount}->${newCount}`);

                backToBackCount = newCount;
                swapsMade++;
                foundImprovement = true;
              } else {
                // Revert
                game1.date = orig1Date;
                game1.startTime = orig1Time;
                game1.endTime = orig1EndTime;
                game2.date = orig2Date;
                game2.startTime = orig2Time;
                game2.endTime = orig2EndTime;
              }
            }
          }
        }

        if (!foundImprovement) break;
      }

      if (swapsMade > 0) {
        console.log(`  [BackToBack] ${divisionName}: reduced from ${initialCount} to ${backToBackCount} (${swapsMade} swaps)`);
      } else if (initialCount > 0) {
        console.log(`  [BackToBack] ${divisionName}: ${backToBackCount} back-to-back (no swaps possible)`);
      }
    }
  }

  /**
   * Schedule Sunday combo practices (field + cage sessions)
   * For each pairing, creates separate practice and cage events:
   * - Team A: practice (field) first half, cage second half
   * - Team B: cage first half, practice (field) second half
   */
  private async scheduleSundayPairedPractices(): Promise<void> {
    verboseLog('\n--- Scheduling Sunday Combo Practices ---');
    this.log('info', 'practice', 'Starting Sunday combo practice scheduling');

    // Find divisions with Sunday paired practice enabled
    const divisionsWithComboPractice: Array<{
      divisionId: string;
      config: DivisionConfig;
      teams: Team[];
    }> = [];

    for (const [divisionId, config] of this.divisionConfigs.entries()) {
      if (config.sundayPairedPracticeEnabled) {
        const divisionTeams = this.teams.filter((t) => t.divisionId === divisionId);
        if (divisionTeams.length >= 2) {
          divisionsWithComboPractice.push({
            divisionId,
            config,
            teams: divisionTeams,
          });
          const divName = this.divisionNames.get(divisionId) || divisionId;
          this.log('info', 'practice', `Division ${divName} has Sunday combo practice enabled`, {
            teamCount: divisionTeams.length,
            durationHours: config.sundayPairedPracticeDurationHours,
            fieldId: config.sundayPairedPracticeFieldId,
            cageId: config.sundayPairedPracticeCageId,
          });
        }
      }
    }

    if (divisionsWithComboPractice.length === 0) {
      verboseLog('No divisions have Sunday combo practice enabled');
      return;
    }

    // Get all Sundays in the season
    // We collect all Sundays and check division-specific blackouts when scheduling each division
    const sundays: string[] = [];
    const allDates = getDateRange(this.season.startDate, this.season.endDate);
    for (const date of allDates) {
      const dayOfWeek = parseLocalDate(date).getDay();
      if (dayOfWeek === 0) {
        // Check if practice is globally blocked on this date (all divisions)
        const isGloballyBlocked = this.season.blackoutDates?.some((b) => {
          // Only check blackouts that apply to ALL divisions
          const appliesToAllDivisions = !b.divisionIds || b.divisionIds.length === 0;
          if (!appliesToAllDivisions) {
            return false;
          }
          // Check if this blackout blocks practices (or all types if not specified)
          const blocksPractice = !b.blockedEventTypes || b.blockedEventTypes.length === 0 ||
            b.blockedEventTypes.includes('practice');
          if (!blocksPractice) {
            return false;
          }
          // Check if date falls within blackout range
          if (b.endDate) {
            return date >= b.date && date <= b.endDate;
          }
          return b.date === date;
        });
        if (!isGloballyBlocked) {
          sundays.push(date);
        }
      }
    }

    verboseLog(`Found ${sundays.length} Sundays in season for combo practices`);

    let totalPractices = 0;
    let totalCages = 0;

    // Schedule for each Sunday and each division
    for (const sunday of sundays) {
      const weekNumber = getWeekNumberForDate(sunday, this.weekDefinitions);

      for (const { divisionId, config, teams } of divisionsWithComboPractice) {
        const divName = this.divisionNames.get(divisionId) || divisionId;

        // Check if this date is blocked for this division (division-specific blackouts)
        if (this.isDateBlockedForDivision(sunday, 'practice', divisionId)) {
          verboseLog(`  ${divName}: Skipping ${sunday} due to division-specific blackout`);
          continue;
        }

        // Generate team pairings for this week
        const teamIds = teams.map((t) => t.id);
        const pairings = generateTeamPairingsForWeek(teamIds, weekNumber);

        if (pairings.length === 0) {
          verboseLog(`  ${divName}: No pairings generated for week ${weekNumber}`);
          continue;
        }

        // Rotate the order of pairings so different pairs get early/late slots each week
        // This ensures fair distribution of time slots across all teams
        const rotationAmount = weekNumber % pairings.length;
        const rotatedPairings = [
          ...pairings.slice(rotationAmount),
          ...pairings.slice(0, rotationAmount),
        ];

        // Get field and cage IDs from config
        const fieldId = config.sundayPairedPracticeFieldId;
        const cageId = config.sundayPairedPracticeCageId;
        const totalDurationHours = config.sundayPairedPracticeDurationHours || 2;
        const halfDurationMinutes = (totalDurationHours * 60) / 2;

        if (!fieldId || !cageId) {
          this.log('warning', 'practice', `Division ${divName} missing field or cage config for combo practice`);
          continue;
        }

        // Find available start time for this field on this Sunday
        // We'll schedule pairs sequentially throughout the day
        const fieldSlots = this.practiceFieldSlots.filter(
          (rs) => rs.slot.date === sunday && rs.resourceId === fieldId
        );

        if (fieldSlots.length === 0) {
          verboseLog(`  ${divName}: No field slots available on ${sunday}`);
          continue;
        }

        // Sort by start time and find first available slot
        fieldSlots.sort((a, b) => {
          const timeDiff = a.slot.startTime.localeCompare(b.slot.startTime);
          if (timeDiff !== 0) return timeDiff;
          // Deterministic tiebreaker: sort by end time, then resource ID
          const endDiff = a.slot.endTime.localeCompare(b.slot.endTime);
          if (endDiff !== 0) return endDiff;
          return a.resourceId.localeCompare(b.resourceId);
        });

        // Get the field's available window for this day
        const dayStart = fieldSlots[0].slot.startTime;
        const dayEnd = fieldSlots[fieldSlots.length - 1].slot.endTime;

        // Calculate start times for each pair
        let currentStartMinutes = timeToMinutes(dayStart);
        const totalDurationMinutes = totalDurationHours * 60;

        for (const [team1Id, team2Id] of rotatedPairings) {
          const slotStartTime = minutesToTime(currentStartMinutes);
          const midTime = minutesToTime(currentStartMinutes + halfDurationMinutes);
          const slotEndTime = minutesToTime(currentStartMinutes + totalDurationMinutes);

          // Check if this time slot fits within the available window
          if (currentStartMinutes + totalDurationMinutes > timeToMinutes(dayEnd)) {
            this.log('warning', 'practice', `Insufficient time on ${sunday} for all combo practices in ${divName}`);
            break;
          }

          // Check for conflicts with already scheduled events (resource conflicts)
          const hasResourceConflict = this.scheduledEvents.some((event) => {
            if (event.date !== sunday) return false;
            if (event.fieldId !== fieldId && event.cageId !== cageId) return false;
            // Check time overlap
            const eventStart = timeToMinutes(event.startTime);
            const eventEnd = timeToMinutes(event.endTime);
            const newStart = currentStartMinutes;
            const newEnd = currentStartMinutes + totalDurationMinutes;
            return newStart < eventEnd && newEnd > eventStart;
          });

          if (hasResourceConflict) {
            verboseLog(`  ${divName}: Resource conflict at ${slotStartTime} on ${sunday}, skipping`);
            currentStartMinutes += totalDurationMinutes;
            continue;
          }

          // Check if either team has a game on this Sunday - games block all other events
          const t1State = this.teamSchedulingStates.get(team1Id);
          const t2State = this.teamSchedulingStates.get(team2Id);
          const team1HasGame = t1State?.gameDates.includes(sunday);
          const team2HasGame = t2State?.gameDates.includes(sunday);

          if (team1HasGame || team2HasGame) {
            const t1Name = teams.find((t) => t.id === team1Id)?.name || team1Id;
            const t2Name = teams.find((t) => t.id === team2Id)?.name || team2Id;
            const conflictingTeam = team1HasGame ? t1Name : t2Name;
            verboseLog(`  ${divName}: Skipping pair ${t1Name}/${t2Name} on ${sunday} - ${conflictingTeam} has a game`);
            currentStartMinutes += totalDurationMinutes;
            continue;
          }

          const team1Name = teams.find((t) => t.id === team1Id)?.name || team1Id;
          const team2Name = teams.find((t) => t.id === team2Id)?.name || team2Id;

          // Create 4 separate events:
          // Team 1: practice (field) first half, cage second half
          // Team 2: cage first half, practice (field) second half

          const team1Practice: ScheduledEventDraft = {
            seasonId: this.season.id,
            divisionId,
            eventType: 'practice',
            date: sunday,
            startTime: slotStartTime,
            endTime: midTime,
            fieldId,
            teamId: team1Id,
          };

          const team1Cage: ScheduledEventDraft = {
            seasonId: this.season.id,
            divisionId,
            eventType: 'cage',
            date: sunday,
            startTime: midTime,
            endTime: slotEndTime,
            cageId,
            teamId: team1Id,
          };

          const team2Cage: ScheduledEventDraft = {
            seasonId: this.season.id,
            divisionId,
            eventType: 'cage',
            date: sunday,
            startTime: slotStartTime,
            endTime: midTime,
            cageId,
            teamId: team2Id,
          };

          const team2Practice: ScheduledEventDraft = {
            seasonId: this.season.id,
            divisionId,
            eventType: 'practice',
            date: sunday,
            startTime: midTime,
            endTime: slotEndTime,
            fieldId,
            teamId: team2Id,
          };

          // Add all 4 events
          this.scheduledEvents.push(team1Practice, team1Cage, team2Cage, team2Practice);
          totalPractices += 2;
          totalCages += 2;

          // Add events to context indexes for conflict detection
          addEventToContext(this.scoringContext!, team1Practice);
          addEventToContext(this.scoringContext!, team1Cage);
          addEventToContext(this.scoringContext!, team2Cage);
          addEventToContext(this.scoringContext!, team2Practice);

          // Update team states for all 4 events
          const team1State = this.teamSchedulingStates.get(team1Id);
          const team2State = this.teamSchedulingStates.get(team2Id);

          if (team1State) {
            updateTeamStateAfterScheduling(team1State, team1Practice, weekNumber);
            updateTeamStateAfterScheduling(team1State, team1Cage, weekNumber);
          }
          if (team2State) {
            updateTeamStateAfterScheduling(team2State, team2Cage, weekNumber);
            updateTeamStateAfterScheduling(team2State, team2Practice, weekNumber);
          }

          // Update scoring context resource usage
          if (this.scoringContext) {
            const halfDurationHours = halfDurationMinutes / 60;
            // Field is used for full duration (team1 first half, team2 second half)
            updateResourceUsage(this.scoringContext, fieldId, sunday, totalDurationHours);
            // Cage is used for full duration (team2 first half, team1 second half)
            updateResourceUsage(this.scoringContext, cageId, sunday, totalDurationHours);
          }

          verboseLog(`  ${divName}: Scheduled ${team1Name} + ${team2Name} combo at ${slotStartTime}-${slotEndTime} on ${sunday}`);
          this.log('info', 'practice', `Scheduled Sunday combo practice`, {
            division: divName,
            team1: team1Name,
            team2: team2Name,
            date: sunday,
            time: `${slotStartTime}-${slotEndTime}`,
          });

          currentStartMinutes += totalDurationMinutes;
        }
      }
    }

    this.log('info', 'practice', `Completed Sunday combo practice scheduling: ${totalPractices} practices, ${totalCages} cage sessions`);
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

      // Get teams that need practices this week, sorted using max-gap balance approach
      // Teams that would create a NEW max gap (exceeding their current worst gap) get priority
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
          // Balance approach: prioritize by practice deficit first, then by gap
          // This ensures teams that are behind on total practices get priority

          // Calculate practice deficit (negative means behind, positive means ahead)
          // Use ratio to handle teams with different totalPracticesNeeded
          const deficitA = a.practicesScheduled - (a.totalPracticesNeeded * (week.weekNumber + 1) / this.weekDefinitions.length);
          const deficitB = b.practicesScheduled - (b.totalPracticesNeeded * (week.weekNumber + 1) / this.weekDefinitions.length);

          // PRIMARY: teams more behind on total practices get priority (larger deficit = more behind)
          // Use a threshold of 0.5 practices to avoid excessive tie-breaking on small differences
          if (Math.abs(deficitA - deficitB) > 0.5) {
            return deficitA - deficitB; // More negative (more behind) comes first
          }

          // SECONDARY: use gap-based approach for tie-breaking
          const weekStartDay = parseLocalDate(week.startDate).getTime();
          const dayMs = 24 * 60 * 60 * 1000;

          // Find last practice date for each team
          const getLastPracticeDay = (ts: TeamSchedulingState): number => {
            let lastDay = -Infinity;
            for (const dateStr of ts.regularPracticeDates) {
              const dayNum = parseLocalDate(dateStr).getTime();
              // Only consider dates before the current week
              if (dayNum < weekStartDay && dayNum > lastDay) {
                lastDay = dayNum;
              }
            }
            // If no practices yet, treat as 4 weeks ago (larger default to prioritize)
            return lastDay === -Infinity ? weekStartDay - 28 * dayMs : lastDay;
          };

          // Calculate potential gap from last practice to mid-week
          const midWeekDay = weekStartDay + 3 * dayMs;
          const lastPracticeA = getLastPracticeDay(a);
          const lastPracticeB = getLastPracticeDay(b);
          const potentialGapA = Math.round((midWeekDay - lastPracticeA) / dayMs);
          const potentialGapB = Math.round((midWeekDay - lastPracticeB) / dayMs);

          // Calculate effective gap: max of worst past gap OR current gap
          const effectiveGapA = Math.max(a.maxPracticeGapSoFar, potentialGapA);
          const effectiveGapB = Math.max(b.maxPracticeGapSoFar, potentialGapB);

          // Teams with LARGER effective gap get priority
          if (effectiveGapA !== effectiveGapB) {
            return effectiveGapB - effectiveGapA;
          }

          // Use teamId for deterministic but unbiased ordering (teamIds are random)
          return a.teamId.localeCompare(b.teamId);
        });

      // Rotate the sorted order based on week number to ensure fairness
      // This way, when teams have similar deficits/gaps (common case), different teams
      // get first pick each week instead of always falling to alphabetical order
      const rotatedByWeek = rotateArray(teamsNeedingPractices, week.weekNumber);

      if (rotatedByWeek.length === 0) {
        verboseLog('  No teams need practices this week');
        continue;
      }

      // Log detailed team processing order for debugging
      this.log('info', 'practice', `Week ${week.weekNumber + 1} team processing order`, {
        weekNumber: week.weekNumber + 1,
        weekStart: week.startDate,
        weekEnd: week.endDate,
        teamOrder: rotatedByWeek.map((ts, index) => {
          const weekStartDay = parseLocalDate(week.startDate).getTime();
          const dayMs = 24 * 60 * 60 * 1000;
          const midWeekDay = weekStartDay + 3 * dayMs;

          // Find last regular practice date
          let lastPracticeDate = 'none';
          let lastPracticeDay = -Infinity;
          for (const dateStr of ts.regularPracticeDates) {
            const dayNum = parseLocalDate(dateStr).getTime();
            if (dayNum < weekStartDay && dayNum > lastPracticeDay) {
              lastPracticeDay = dayNum;
              lastPracticeDate = dateStr;
            }
          }

          const potentialGap = lastPracticeDay === -Infinity
            ? 28
            : Math.round((midWeekDay - lastPracticeDay) / dayMs);
          const effectiveGap = Math.max(ts.maxPracticeGapSoFar, potentialGap);
          const deficit = ts.practicesScheduled - (ts.totalPracticesNeeded * (week.weekNumber + 1) / this.weekDefinitions.length);

          return {
            order: index + 1,
            team: ts.teamName,
            division: ts.divisionName,
            practicesScheduled: ts.practicesScheduled,
            totalNeeded: ts.totalPracticesNeeded,
            deficit: deficit.toFixed(2),
            lastPractice: lastPracticeDate,
            potentialGap,
            maxGapSoFar: ts.maxPracticeGapSoFar,
            effectiveGap,
          };
        }),
      });

      // Check capacity: count total practice slots needed vs available
      let totalPracticesNeeded = 0;
      for (const ts of teamsNeedingPractices) {
        const config = this.divisionConfigs.get(ts.divisionId);
        if (config) {
          const weekEvents = ts.eventsPerWeek.get(week.weekNumber) || { games: 0, practices: 0, cages: 0, spilloverGames: 0 };
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
        // Check if any team still needs a practice this week, using max-gap balance approach
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
            // Re-sort: prioritize by practice deficit first, then by gap
            // This ensures teams that are behind on total practices get priority

            // Calculate practice deficit (negative means behind, positive means ahead)
            const deficitA = a.practicesScheduled - (a.totalPracticesNeeded * (week.weekNumber + 1) / this.weekDefinitions.length);
            const deficitB = b.practicesScheduled - (b.totalPracticesNeeded * (week.weekNumber + 1) / this.weekDefinitions.length);

            // PRIMARY: teams more behind on total practices get priority
            if (Math.abs(deficitA - deficitB) > 0.5) {
              return deficitA - deficitB; // More negative (more behind) comes first
            }

            // SECONDARY: gap-based tie-breaking
            const weekStartDay = parseLocalDate(week.startDate).getTime();
            const dayMs = 24 * 60 * 60 * 1000;

            const getLastPracticeDay = (ts: TeamSchedulingState): number => {
              let lastDay = -Infinity;
              for (const dateStr of ts.regularPracticeDates) {
                const dayNum = parseLocalDate(dateStr).getTime();
                if (dayNum < weekStartDay && dayNum > lastDay) {
                  lastDay = dayNum;
                }
              }
              return lastDay === -Infinity ? weekStartDay - 28 * dayMs : lastDay;
            };

            const midWeekDay = weekStartDay + 3 * dayMs;
            const lastPracticeA = getLastPracticeDay(a);
            const lastPracticeB = getLastPracticeDay(b);
            const potentialGapA = Math.round((midWeekDay - lastPracticeA) / dayMs);
            const potentialGapB = Math.round((midWeekDay - lastPracticeB) / dayMs);

            const effectiveGapA = Math.max(a.maxPracticeGapSoFar, potentialGapA);
            const effectiveGapB = Math.max(b.maxPracticeGapSoFar, potentialGapB);

            if (effectiveGapA !== effectiveGapB) {
              return effectiveGapB - effectiveGapA;
            }

            // Use teamId for deterministic but unbiased ordering (teamIds are random)
            return a.teamId.localeCompare(b.teamId);
          });

        if (stillNeedPractices.length === 0) {
          verboseLog(`  All teams met practice requirements for this week`);
          break;
        }

        // Rotate by round number to ensure fairness among teams with similar priority
        const rotatedStillNeed = rotateArray(stillNeedPractices, round);

        // Compute slot availability for scarcity calculation
        this.computeTeamSlotAvailability(rotatedStillNeed, practiceFieldSlots, week);

        verboseLog(`  Round ${round + 1}: ${rotatedStillNeed.length} teams still need practices`);

        let anyScheduledThisRound = false;

        for (const teamState of rotatedStillNeed) {
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
          // and not blocked by division blackouts
          const weekSlots = allWeekSlots.filter((rs) =>
            this.isFieldCompatibleWithDivision(rs.resourceId, teamState.divisionId) &&
            !this.isDateBlockedForDivision(rs.slot.date, 'practice', teamState.divisionId)
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

          // Log detailed candidate analysis for A and Tball divisions (debug gap issues)
          if ((teamState.divisionName === 'A' || teamState.divisionName === 'Tball') && this.scoringContext) {
            // Score all candidates to get the breakdown by date
            const scoredCandidates = candidates.map(c =>
              calculatePlacementScore(c, teamState, this.scoringContext!, this.scoringWeights)
            );

            // Group by date and find best per date
            const byDate = new Map<string, typeof scoredCandidates[0]>();
            for (const sc of scoredCandidates) {
              const existing = byDate.get(sc.date);
              if (!existing || sc.score > existing.score) {
                byDate.set(sc.date, sc);
              }
            }

            // Sort dates and get top 5 date candidates
            // Use dateSelectionScore (excludes earliestTime and timeAdjacency) for sorting
            const topByDate = Array.from(byDate.entries())
              .sort((a, b) => {
                const aDateScore = a[1].score - (a[1].scoreBreakdown?.earliestTime || 0) - (a[1].scoreBreakdown?.timeAdjacency || 0);
                const bDateScore = b[1].score - (b[1].scoreBreakdown?.earliestTime || 0) - (b[1].scoreBreakdown?.timeAdjacency || 0);
                return bDateScore - aDateScore;
              })
              .slice(0, 7)
              .map(([date, sc]) => {
                const dateSelectionScore = sc.score - (sc.scoreBreakdown?.earliestTime || 0) - (sc.scoreBreakdown?.timeAdjacency || 0);
                return {
                  date,
                  dayOfWeek: ScheduleGenerator.DAY_NAMES[sc.dayOfWeek],
                  resource: sc.resourceName,
                  score: sc.score.toFixed(1),
                  dateSelectionScore: dateSelectionScore.toFixed(1),
                  largeGapPenalty: sc.scoreBreakdown?.largeGapPenalty?.toFixed(1),
                  practiceSpacing: sc.scoreBreakdown?.practiceSpacing?.toFixed(1),
                  daySpread: sc.scoreBreakdown?.daySpread?.toFixed(1),
                  earliestTime: sc.scoreBreakdown?.earliestTime?.toFixed(1),
                  timeAdjacency: sc.scoreBreakdown?.timeAdjacency?.toFixed(1),
                  resourceUtilization: sc.scoreBreakdown?.resourceUtilization?.toFixed(1),
                };
              });

            this.log('info', 'practice', `Candidate analysis for ${teamState.teamName} (${teamState.divisionName})`, {
              team: teamState.teamName,
              division: teamState.divisionName,
              totalCandidates: candidates.length,
              uniqueDates: byDate.size,
              selectedDate: bestCandidate.date,
              selectedScore: bestCandidate.score.toFixed(1),
              topCandidatesByDate: topByDate,
            });
          }

          // Safeguard: Double-check that team doesn't have a game on this date
          // This should never happen since generateCandidatesForTeamEvent filters out game dates,
          // but this catches any edge cases that might slip through
          if (teamState.gameDates.includes(bestCandidate.date)) {
            this.log('error', 'practice', `BUG: Attempted to schedule practice for ${teamState.teamName} on ${bestCandidate.date} but team has a game that day!`, {
              teamId: teamState.teamId,
              teamName: teamState.teamName,
              date: bestCandidate.date,
              gameDates: teamState.gameDates,
              candidateScore: bestCandidate.score,
            });
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
              const weekEvents = ts.eventsPerWeek.get(week.weekNumber) || { games: 0, practices: 0, cages: 0, spilloverGames: 0 };
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

    // Filter practice field slots to only those within this week, compatible with the division,
    // and not blocked by division blackouts
    const allSlotsInWeek = this.practiceFieldSlots.filter(
      rs => rs.slot.date >= week.startDate && rs.slot.date <= week.endDate
    );
    const fieldSlots = allSlotsInWeek.filter(
      rs => this.isFieldCompatibleWithDivision(rs.resourceId, divisionId) &&
            !this.isDateBlockedForDivision(rs.slot.date, 'practice', divisionId)
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

      // Check if this slot is single-event-only and already has an event
      if (rs.singleEventOnly) {
        let fieldHasEventOnDate = false;
        if (this.scoringContext?.eventsByDateResource) {
          const key = `${rs.slot.date}-${rs.resourceId}`;
          const fieldEvents = this.scoringContext.eventsByDateResource.get(key);
          fieldHasEventOnDate = fieldEvents !== undefined && fieldEvents.length > 0;
        } else {
          fieldHasEventOnDate = this.scheduledEvents.some(event =>
            event.date === rs.slot.date && event.fieldId === rs.resourceId
          );
        }

        if (fieldHasEventOnDate) {
          skipReasons['single_event_slot_taken'] = (skipReasons['single_event_slot_taken'] || 0) + 1;
          if (skipDetails.length < 10) {
            skipDetails.push({
              date: rs.slot.date,
              field: rs.resourceName,
              reason: `${rs.resourceName} on ${dayName} is single-event-only and already has an event`,
            });
          }
          continue;
        }
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

    // Check if this slot is single-event-only and already has an event
    if (fieldSlot.singleEventOnly) {
      let fieldHasEventOnDate = false;
      if (this.scoringContext?.eventsByDateResource) {
        const key = `${date}-${fieldSlot.resourceId}`;
        const fieldEvents = this.scoringContext.eventsByDateResource.get(key);
        fieldHasEventOnDate = fieldEvents !== undefined && fieldEvents.length > 0;
      } else {
        fieldHasEventOnDate = this.scheduledEvents.some(event =>
          event.date === date && event.fieldId === fieldSlot.resourceId
        );
      }
      if (fieldHasEventOnDate) {
        return false;
      }
    }

    // Check if this date is blocked for practice or cage for this division
    if (this.isDateBlockedForDivision(date, 'practice', divisionId) ||
        this.isDateBlockedForDivision(date, 'cage', divisionId)) {
      return false;
    }

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
        const cageWarmupConflict = this.scoringContext ? hasWarmupConflict(cageSlot.resourceId, date, cageStart, cageEnd, this.scoringContext) : false;

        if (!fieldConflict && !cageConflict && !cageWarmupConflict) {
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
        const cageWarmupConflictAlt = this.scoringContext ? hasWarmupConflict(cageSlot.resourceId, date, cageStartAlt, cageEndAlt, this.scoringContext) : false;

        if (!fieldConflictAlt && !cageConflictAlt && !cageWarmupConflictAlt) {
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
          const diff = deficitB - deficitA;
          if (diff !== 0) return diff;
          // Deterministic tiebreaker: sort by team ID
          return a.teamId.localeCompare(b.teamId);
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
            const diff = deficitB - deficitA;
            if (diff !== 0) return diff;
            // Deterministic tiebreaker: sort by team ID
            return a.teamId.localeCompare(b.teamId);
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
          // and not blocked by division blackouts
          const weekSlots = allWeekCageSlots
            .filter((rs) =>
              this.isCageCompatibleWithDivision(rs.resourceId, teamState.divisionId) &&
              !this.isDateBlockedForDivision(rs.slot.date, 'cage', teamState.divisionId)
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

          // Safeguard: Double-check that team doesn't have a game on this date
          // This should never happen since generateCandidatesForTeamEvent filters out game dates,
          // but this catches any edge cases that might slip through
          if (teamState.gameDates.includes(bestCandidate.date)) {
            this.log('error', 'cage', `BUG: Attempted to schedule cage session for ${teamState.teamName} on ${bestCandidate.date} but team has a game that day!`, {
              teamId: teamState.teamId,
              teamName: teamState.teamName,
              date: bestCandidate.date,
              gameDates: teamState.gameDates,
              candidateScore: bestCandidate.score,
            });
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
              const weekEvents = ts.eventsPerWeek.get(week.weekNumber) || { games: 0, practices: 0, cages: 0, spilloverGames: 0 };
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

    // Filter cage slots to only those within this week, compatible with the division,
    // and not blocked by division blackouts
    const filteredCageSlots = this.cageSlots.filter(
      rs => rs.slot.date >= week.startDate &&
      rs.slot.date <= week.endDate &&
      this.isCageCompatibleWithDivision(rs.resourceId, divisionId) &&
      !this.isDateBlockedForDivision(rs.slot.date, 'cage', divisionId)
    );
    verboseLog(`      Cage availability windows in this week: ${filteredCageSlots.length}`);

    // Use division-configured cage session duration, default to 1 hour
    const cageSessionDuration = config?.cageSessionDurationHours ?? 1;

    const skipReasons: Record<string, number> = {};
    const skipDetails: Array<{ date: string; cage: string; reason: string }> = [];

    // Find available windows that can accommodate a cage session
    for (const rs of filteredCageSlots) {
      const dayName = ScheduleGenerator.DAY_NAMES[rs.slot.dayOfWeek];

      // Skip days where team already has a practice (no cage + practice on same day)
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
        skipReasons['has_practice'] = (skipReasons['has_practice'] || 0) + 1;
        if (skipDetails.length < 10) {
          skipDetails.push({
            date: rs.slot.date,
            cage: rs.resourceName,
            reason: `${teamName} already has practice on this ${dayName}`,
          });
        }
        continue;
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
        // Safeguard: Check that team doesn't have a game on this date
        const teamStateForCheck = this.teamSchedulingStates.get(teamId);
        if (teamStateForCheck?.gameDates.includes(rs.slot.date)) {
          skipReasons['team_has_game'] = (skipReasons['team_has_game'] || 0) + 1;
          if (skipDetails.length < 10) {
            skipDetails.push({
              date: rs.slot.date,
              cage: rs.resourceName,
              reason: `${teamName} has a game on this date`,
            });
          }
          this.log('warning', 'cage', `Skipping cage slot for ${teamName} on ${rs.slot.date} - team has a game`, {
            teamId,
            teamName,
            date: rs.slot.date,
            gameDates: teamStateForCheck.gameDates,
          });
          continue;
        }

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
   * Build game warmup blocks from scheduled games.
   * For each game, creates warmup blocks on compatible cages for the period
   * before the game starts (based on gameArriveBeforeHours).
   */
  private buildGameWarmupBlocks(): void {
    if (!this.scoringContext) return;

    // Initialize the warmup blocks map
    this.scoringContext.gameWarmupBlocks = new Map();

    // Get all scheduled games
    const scheduledGames = this.scheduledEvents.filter(e => e.eventType === 'game');

    for (const game of scheduledGames) {
      const config = this.divisionConfigs.get(game.divisionId);
      if (!config) continue;

      const arriveBeforeHours = config.gameArriveBeforeHours || 0;
      if (arriveBeforeHours <= 0) {
        continue;
      }

      // Only block cages for divisions that have cage time
      if (!config.cageSessionsPerWeek || config.cageSessionsPerWeek <= 0) {
        continue;
      }

      // Calculate warmup window: game.startTime to (game.startTime + arrive_before)
      // Note: game.startTime in the database is the arrive time (when players should arrive),
      // and the duration includes the arrive-before period. So the warmup window is from
      // the stored start time until (start + arriveBeforeHours).
      const [gameHours, gameMinutes] = game.startTime.split(':').map(Number);
      const gameStartMinutes = gameHours * 60 + gameMinutes;
      const warmupEndMinutes = gameStartMinutes + Math.round(arriveBeforeHours * 60);

      // Format times as HH:MM
      const formatTime = (minutes: number): string => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      const warmupStartTime = game.startTime;
      const warmupEndTime = formatTime(warmupEndMinutes);

      // Find all cages compatible with this division
      for (const [cageId, compatibility] of this.cageDivisionCompatibility) {
        // Empty compatibility means all divisions allowed
        const isCompatible = compatibility.length === 0 || compatibility.includes(game.divisionId);
        if (!isCompatible) continue;

        const key = `${game.date}-${cageId}`;
        if (!this.scoringContext.gameWarmupBlocks.has(key)) {
          this.scoringContext.gameWarmupBlocks.set(key, []);
        }

        // Create a unique game ID for debugging (combining date, time, and teams)
        const gameId = `${game.date}-${game.startTime}-${game.homeTeamId}-${game.awayTeamId}`;

        this.scoringContext.gameWarmupBlocks.get(key)!.push({
          startTime: warmupStartTime,
          endTime: warmupEndTime,
          gameId,
        });
      }
    }

    // Count warmup blocks created for logging
    let totalBlocks = 0;
    for (const blocks of this.scoringContext.gameWarmupBlocks.values()) {
      totalBlocks += blocks.length;
    }

    if (totalBlocks > 0) {
      this.log('info', 'cage', `Built ${totalBlocks} warmup blocks for cage scheduling`);
    }
  }

  /**
   * Check if a date is blocked for a specific event type for a division.
   * Uses season blackouts with divisionIds to check if the date/event type is blocked.
   * Supports both single dates and date ranges.
   * A blackout applies to a division if:
   * - divisionIds is not set or empty (applies to ALL divisions)
   * - OR divisionIds includes the given divisionId
   */
  private isDateBlockedForDivision(
    date: string,
    eventType: 'game' | 'practice' | 'cage',
    divisionId: string
  ): boolean {
    if (!this.season.blackoutDates || this.season.blackoutDates.length === 0) {
      return false;
    }
    return this.season.blackoutDates.some((blackout) => {
      // Check if this blackout applies to this division
      const appliesToDivision = !blackout.divisionIds || blackout.divisionIds.length === 0 ||
        blackout.divisionIds.includes(divisionId);
      if (!appliesToDivision) {
        return false;
      }

      // Check if this blackout blocks this event type
      const blocksEventType = !blackout.blockedEventTypes || blackout.blockedEventTypes.length === 0 ||
        blackout.blockedEventTypes.includes(eventType);
      if (!blocksEventType) {
        return false;
      }

      // Check if date falls within the blackout (single date or range)
      if (blackout.endDate) {
        return date >= blackout.date && date <= blackout.endDate;
      }
      return blackout.date === date;
    });
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
      // Also exclude dates blocked by division blackouts
      const teamWeekSlots = resourceSlots.filter((rs) =>
        week.dates.includes(rs.slot.date) &&
        this.isFieldCompatibleWithDivision(rs.resourceId, teamState.divisionId) &&
        !teamState.fieldDatesUsed.has(rs.slot.date) && // Team can't have two field events on same day
        !this.isDateBlockedForDivision(rs.slot.date, 'practice', teamState.divisionId)
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
