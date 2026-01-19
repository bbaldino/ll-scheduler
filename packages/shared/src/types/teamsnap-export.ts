/**
 * TeamSnap export format types
 * Based on TeamSnap's team schedule import format
 */

/**
 * A single row in the TeamSnap CSV export
 */
export interface TeamSnapExportRow {
  date: string; // mm/dd/yyyy format
  startTime: string; // hh:mm:ss AM/PM format
  endTime: string; // hh:mm:ss AM/PM format
  arrivalTime: number; // Minutes before start (60 for games, 10 for practices)
  shortLabel: string; // "" for games, "Batting Cages" or "Field Practice" for practices
  eventType: 'Game' | 'Practice'; // TeamSnap event type
  division: string; // Division name
  homeTeam: string; // Home team for games, practicing team for practices
  awayTeam: string; // Away team for games, blank for practices
  location: string; // Field or cage name
}

/**
 * Export options for TeamSnap format
 */
export interface TeamSnapExportOptions {
  seasonId: string;
  divisionId?: string; // Optional filter by division
  teamId?: string; // Optional filter by team
}

/**
 * CSV column headers for TeamSnap export
 */
export const TEAMSNAP_CSV_HEADERS = [
  'Date',
  'Start time',
  'End time',
  'Arrival Time',
  'Short label',
  'Event type',
  'Division',
  'Home Team',
  'Away Team',
  'Location',
] as const;
