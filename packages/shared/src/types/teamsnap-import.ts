/**
 * TeamSnap import format types
 * For importing CSV files exported in TeamSnap format
 */

import { TEAMSNAP_CSV_HEADERS } from './teamsnap-export.js';

// Re-export for convenience
export { TEAMSNAP_CSV_HEADERS };

/**
 * A parsed row from the TeamSnap CSV import (before validation)
 */
export interface TeamSnapImportRow {
  rowNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  arrivalTime: string;
  shortLabel: string;
  eventType: string;
  division: string;
  homeTeam: string;
  awayTeam: string;
  location: string;
}

/**
 * Internal event types used by the scheduler
 */
export type InternalEventType = 'game' | 'practice' | 'cage';

/**
 * A row after validation and resolution to internal IDs
 */
export interface ResolvedImportRow {
  rowNumber: number;
  internalEventType: InternalEventType;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  divisionId: string;
  fieldId?: string;
  cageId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  teamId?: string;
}

/**
 * A validation error or warning for an import row
 */
export interface ImportValidationError {
  rowNumber: number;
  field: string;
  message: string;
  value?: string;
}

/**
 * Result of validating import rows
 */
export interface ImportValidationResult {
  validRows: ResolvedImportRow[];
  errors: ImportValidationError[];
  warnings: ImportValidationError[];
  duplicateRows: number[]; // Row numbers that match existing events
}

/**
 * Options for executing an import
 */
export interface ImportOptions {
  seasonId: string;
  mode: 'merge' | 'overwrite';
  divisionIds?: string[]; // For overwrite: which divisions to clear
}

/**
 * Result of executing an import
 */
export interface ImportResult {
  createdCount: number;
  deletedCount?: number; // Only for overwrite mode
  duplicatesSkipped: number; // Events that matched existing (merge mode)
}

/**
 * Input to the validate endpoint
 */
export interface ValidateImportInput {
  seasonId: string;
  rows: TeamSnapImportRow[];
}

/**
 * Input to the execute endpoint
 */
export interface ExecuteImportInput {
  seasonId: string;
  rows: TeamSnapImportRow[];
  options: ImportOptions;
}
