import type {
  TeamSnapImportRow,
  ResolvedImportRow,
  ImportValidationError,
  ImportValidationResult,
  ImportOptions,
  ImportResult,
  InternalEventType,
  CreateScheduledEventInput,
} from '@ll-scheduler/shared';
import { listDivisions } from './divisions.js';
import { listTeams } from './teams.js';
import { listFields } from './fields.js';
import { listBattingCages } from './batting-cages.js';
import {
  listScheduledEvents,
  createScheduledEventsBulk,
  deleteScheduledEventsBulk,
} from './scheduled-events.js';

/**
 * Parse date from TeamSnap format (m/d/yyyy) to ISO format (YYYY-MM-DD)
 */
export function parseDateFromTeamSnap(date: string): string | null {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  const [, month, day, year] = match;
  const m = month.padStart(2, '0');
  const d = day.padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/**
 * Parse time from TeamSnap format (h:mm:ss AM/PM) to 24-hour format (HH:MM)
 */
export function parseTimeFromTeamSnap(time: string): string | null {
  const match = time.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }
  let [, hour, minute, , period] = match;
  let h = parseInt(hour, 10);
  if (period.toUpperCase() === 'PM' && h !== 12) {
    h += 12;
  } else if (period.toUpperCase() === 'AM' && h === 12) {
    h = 0;
  }
  return `${h.toString().padStart(2, '0')}:${minute}`;
}

/**
 * Determine internal event type from TeamSnap eventType and shortLabel
 */
export function determineEventType(
  eventType: string,
  shortLabel: string
): InternalEventType | null {
  const normalizedEventType = eventType.trim().toLowerCase();
  const normalizedLabel = shortLabel.trim().toLowerCase();

  if (normalizedEventType === 'game') {
    if (normalizedLabel === '' || normalizedLabel === 'game') {
      return 'game';
    }
  } else if (normalizedEventType === 'practice') {
    if (normalizedLabel === 'field practice' || normalizedLabel === '') {
      return 'practice';
    } else if (normalizedLabel === 'batting cages') {
      return 'cage';
    }
  }

  return null;
}

/**
 * Find similar names for suggestions
 */
function findSimilarNames(target: string, names: string[], maxResults = 3): string[] {
  const normalized = target.toLowerCase().trim();
  return names
    .filter((name) => {
      const n = name.toLowerCase();
      return (
        n.includes(normalized) ||
        normalized.includes(n) ||
        levenshteinDistance(normalized, n) <= 3
      );
    })
    .slice(0, maxResults);
}

/**
 * Simple Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

interface LookupMaps {
  divisionsByName: Map<string, { id: string; name: string }>;
  teamsByNameAndDivision: Map<string, { id: string; name: string; divisionId: string }>;
  fieldsByName: Map<string, { id: string; name: string }>;
  cagesByName: Map<string, { id: string; name: string }>;
}

/**
 * Build lookup maps for name resolution
 */
async function buildLookupMaps(db: D1Database, seasonId: string): Promise<LookupMaps> {
  const [divisions, teams, fields, cages] = await Promise.all([
    listDivisions(db),
    listTeams(db, seasonId),
    listFields(db),
    listBattingCages(db),
  ]);

  const divisionsByName = new Map<string, { id: string; name: string }>();
  for (const div of divisions) {
    divisionsByName.set(div.name.toLowerCase().trim(), { id: div.id, name: div.name });
  }

  const teamsByNameAndDivision = new Map<
    string,
    { id: string; name: string; divisionId: string }
  >();
  for (const team of teams) {
    // Key is "divisionId:teamName" for disambiguation
    const key = `${team.divisionId}:${team.name.toLowerCase().trim()}`;
    teamsByNameAndDivision.set(key, {
      id: team.id,
      name: team.name,
      divisionId: team.divisionId,
    });
  }

  const fieldsByName = new Map<string, { id: string; name: string }>();
  for (const field of fields) {
    fieldsByName.set(field.name.toLowerCase().trim(), { id: field.id, name: field.name });
  }

  const cagesByName = new Map<string, { id: string; name: string }>();
  for (const cage of cages) {
    cagesByName.set(cage.name.toLowerCase().trim(), { id: cage.id, name: cage.name });
  }

  return { divisionsByName, teamsByNameAndDivision, fieldsByName, cagesByName };
}

/**
 * Check if two events are duplicates
 */
function isDuplicateEvent(
  resolved: ResolvedImportRow,
  existing: {
    eventType: string;
    date: string;
    startTime: string;
    fieldId?: string;
    cageId?: string;
    homeTeamId?: string;
    awayTeamId?: string;
    teamId?: string;
  }
): boolean {
  if (resolved.internalEventType !== existing.eventType) return false;
  if (resolved.date !== existing.date) return false;
  if (resolved.startTime !== existing.startTime) return false;

  // Check location
  if (resolved.fieldId && resolved.fieldId !== existing.fieldId) return false;
  if (resolved.cageId && resolved.cageId !== existing.cageId) return false;

  // Check teams
  if (resolved.internalEventType === 'game') {
    if (resolved.homeTeamId !== existing.homeTeamId) return false;
    if (resolved.awayTeamId !== existing.awayTeamId) return false;
  } else {
    if (resolved.teamId !== existing.teamId) return false;
  }

  return true;
}

/**
 * Validate and resolve import rows to internal IDs
 */
export async function validateAndResolveRows(
  db: D1Database,
  seasonId: string,
  rows: TeamSnapImportRow[]
): Promise<ImportValidationResult> {
  const lookups = await buildLookupMaps(db, seasonId);
  const existingEvents = await listScheduledEvents(db, { seasonId });

  const validRows: ResolvedImportRow[] = [];
  const errors: ImportValidationError[] = [];
  const warnings: ImportValidationError[] = [];
  const duplicateRows: number[] = [];

  const allDivisionNames = Array.from(lookups.divisionsByName.values()).map((d) => d.name);
  const allFieldNames = Array.from(lookups.fieldsByName.values()).map((f) => f.name);
  const allCageNames = Array.from(lookups.cagesByName.values()).map((c) => c.name);

  for (const row of rows) {
    const rowErrors: ImportValidationError[] = [];

    // Parse date
    const parsedDate = parseDateFromTeamSnap(row.date);
    if (!parsedDate) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'date',
        message: 'Invalid date format. Expected m/d/yyyy',
        value: row.date,
      });
    }

    // Parse times
    const parsedStartTime = parseTimeFromTeamSnap(row.startTime);
    if (!parsedStartTime) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'startTime',
        message: 'Invalid time format. Expected h:mm:ss AM/PM',
        value: row.startTime,
      });
    }

    const parsedEndTime = parseTimeFromTeamSnap(row.endTime);
    if (!parsedEndTime) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'endTime',
        message: 'Invalid time format. Expected h:mm:ss AM/PM',
        value: row.endTime,
      });
    }

    // Determine event type
    const internalEventType = determineEventType(row.eventType, row.shortLabel);
    if (!internalEventType) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'eventType',
        message: `Unknown event type/label combination: "${row.eventType}" / "${row.shortLabel}"`,
        value: `${row.eventType}/${row.shortLabel}`,
      });
    }

    // Resolve division
    const divisionKey = row.division.toLowerCase().trim();
    const division = lookups.divisionsByName.get(divisionKey);
    if (!division) {
      const similar = findSimilarNames(row.division, allDivisionNames);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'division',
        message: `Division not found: "${row.division}".${suggestion}`,
        value: row.division,
      });
    }

    // Get all team names for this division for suggestions
    const divisionTeamNames: string[] = [];
    if (division) {
      for (const [key, team] of lookups.teamsByNameAndDivision) {
        if (team.divisionId === division.id) {
          divisionTeamNames.push(team.name);
        }
      }
    }

    // Resolve teams based on event type
    let homeTeamId: string | undefined;
    let awayTeamId: string | undefined;
    let teamId: string | undefined;

    if (internalEventType === 'game') {
      // Games need home and away teams
      if (!row.homeTeam.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'homeTeam',
          message: 'Home team is required for games',
        });
      } else if (division) {
        const homeKey = `${division.id}:${row.homeTeam.toLowerCase().trim()}`;
        const homeTeam = lookups.teamsByNameAndDivision.get(homeKey);
        if (!homeTeam) {
          const similar = findSimilarNames(row.homeTeam, divisionTeamNames);
          const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'homeTeam',
            message: `Home team not found in ${division.name}: "${row.homeTeam}".${suggestion}`,
            value: row.homeTeam,
          });
        } else {
          homeTeamId = homeTeam.id;
        }
      }

      if (!row.awayTeam.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'awayTeam',
          message: 'Away team is required for games',
        });
      } else if (division) {
        const awayKey = `${division.id}:${row.awayTeam.toLowerCase().trim()}`;
        const awayTeam = lookups.teamsByNameAndDivision.get(awayKey);
        if (!awayTeam) {
          const similar = findSimilarNames(row.awayTeam, divisionTeamNames);
          const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'awayTeam',
            message: `Away team not found in ${division.name}: "${row.awayTeam}".${suggestion}`,
            value: row.awayTeam,
          });
        } else {
          awayTeamId = awayTeam.id;
        }
      }
    } else if (internalEventType === 'practice' || internalEventType === 'cage') {
      // Practices and cages use homeTeam as the practicing team
      if (!row.homeTeam.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'homeTeam',
          message: 'Team is required for practices',
        });
      } else if (division) {
        const teamKey = `${division.id}:${row.homeTeam.toLowerCase().trim()}`;
        const team = lookups.teamsByNameAndDivision.get(teamKey);
        if (!team) {
          const similar = findSimilarNames(row.homeTeam, divisionTeamNames);
          const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'homeTeam',
            message: `Team not found in ${division.name}: "${row.homeTeam}".${suggestion}`,
            value: row.homeTeam,
          });
        } else {
          teamId = team.id;
        }
      }
    }

    // Resolve location (field or cage)
    let fieldId: string | undefined;
    let cageId: string | undefined;

    if (row.location.trim()) {
      const locationKey = row.location.toLowerCase().trim();

      if (internalEventType === 'cage') {
        const cage = lookups.cagesByName.get(locationKey);
        if (!cage) {
          const similar = findSimilarNames(row.location, allCageNames);
          const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'location',
            message: `Batting cage not found: "${row.location}".${suggestion}`,
            value: row.location,
          });
        } else {
          cageId = cage.id;
        }
      } else {
        // Game or practice - use field
        const field = lookups.fieldsByName.get(locationKey);
        if (!field) {
          const similar = findSimilarNames(row.location, allFieldNames);
          const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'location',
            message: `Field not found: "${row.location}".${suggestion}`,
            value: row.location,
          });
        } else {
          fieldId = field.id;
        }
      }
    }

    // If there are errors for this row, add them and continue
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    // Build resolved row
    const resolvedRow: ResolvedImportRow = {
      rowNumber: row.rowNumber,
      internalEventType: internalEventType!,
      date: parsedDate!,
      startTime: parsedStartTime!,
      endTime: parsedEndTime!,
      divisionId: division!.id,
      fieldId,
      cageId,
      homeTeamId,
      awayTeamId,
      teamId,
    };

    // Check for duplicates against existing events
    const isDuplicate = existingEvents.some((existing) =>
      isDuplicateEvent(resolvedRow, existing)
    );

    if (isDuplicate) {
      duplicateRows.push(row.rowNumber);
      warnings.push({
        rowNumber: row.rowNumber,
        field: '',
        message: 'This event matches an existing event in the schedule',
      });
    }

    validRows.push(resolvedRow);
  }

  return { validRows, errors, warnings, duplicateRows };
}

/**
 * Execute the import
 */
export async function executeImport(
  db: D1Database,
  seasonId: string,
  rows: TeamSnapImportRow[],
  options: ImportOptions
): Promise<ImportResult> {
  // Re-validate to get resolved rows
  const validation = await validateAndResolveRows(db, seasonId, rows);

  if (validation.errors.length > 0) {
    throw new Error(
      `Cannot execute import with validation errors: ${validation.errors.length} errors found`
    );
  }

  let deletedCount = 0;
  let duplicatesSkipped = 0;

  // Handle overwrite mode - delete existing events for specified divisions
  if (options.mode === 'overwrite' && options.divisionIds && options.divisionIds.length > 0) {
    deletedCount = await deleteScheduledEventsBulk(db, {
      seasonId,
      divisionIds: options.divisionIds,
    });
  }

  // Filter out duplicates in merge mode
  let rowsToCreate = validation.validRows;
  if (options.mode === 'merge') {
    const duplicateSet = new Set(validation.duplicateRows);
    rowsToCreate = validation.validRows.filter((r) => !duplicateSet.has(r.rowNumber));
    duplicatesSkipped = validation.duplicateRows.length;
  }

  // Convert resolved rows to event inputs
  const eventInputs: CreateScheduledEventInput[] = rowsToCreate.map((row) => ({
    seasonId,
    divisionId: row.divisionId,
    eventType: row.internalEventType,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    fieldId: row.fieldId,
    cageId: row.cageId,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    teamId: row.teamId,
    status: 'scheduled' as const,
  }));

  // Bulk create events
  const createdCount = await createScheduledEventsBulk(db, eventInputs);

  return {
    createdCount,
    deletedCount: options.mode === 'overwrite' ? deletedCount : undefined,
    duplicatesSkipped,
  };
}
