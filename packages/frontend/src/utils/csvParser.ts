import type { TeamSnapImportRow } from '@ll-scheduler/shared';
import { TEAMSNAP_CSV_HEADERS } from '@ll-scheduler/shared';

export interface CsvParseResult {
  rows: TeamSnapImportRow[];
  errors: string[];
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote inside quoted value
        current += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        // End of quoted value
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        // Start of quoted value
        inQuotes = true;
      } else if (char === ',') {
        // End of field
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  // Add the last field
  values.push(current.trim());

  return values;
}

/**
 * Validate CSV headers match expected TeamSnap format
 */
function validateHeaders(headers: string[]): string | null {
  if (headers.length !== TEAMSNAP_CSV_HEADERS.length) {
    return `Expected ${TEAMSNAP_CSV_HEADERS.length} columns but found ${headers.length}`;
  }

  for (let i = 0; i < TEAMSNAP_CSV_HEADERS.length; i++) {
    const expected = TEAMSNAP_CSV_HEADERS[i].toLowerCase();
    const actual = headers[i].toLowerCase();
    if (expected !== actual) {
      return `Column ${i + 1} should be "${TEAMSNAP_CSV_HEADERS[i]}" but found "${headers[i]}"`;
    }
  }

  return null;
}

/**
 * Parse a TeamSnap CSV file content into structured rows
 */
export function parseTeamSnapCsv(content: string): CsvParseResult {
  const errors: string[] = [];
  const rows: TeamSnapImportRow[] = [];

  // Normalize line endings and split into lines
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Filter out empty lines
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

  if (nonEmptyLines.length === 0) {
    errors.push('CSV file is empty');
    return { rows, errors };
  }

  // Parse and validate headers
  const headers = parseCsvLine(nonEmptyLines[0]);
  const headerError = validateHeaders(headers);
  if (headerError) {
    errors.push(`Invalid header: ${headerError}`);
    return { rows, errors };
  }

  // Parse data rows
  for (let i = 1; i < nonEmptyLines.length; i++) {
    const line = nonEmptyLines[i];
    const rowNumber = i + 1; // 1-indexed, accounting for header

    const values = parseCsvLine(line);

    if (values.length !== TEAMSNAP_CSV_HEADERS.length) {
      errors.push(
        `Row ${rowNumber}: Expected ${TEAMSNAP_CSV_HEADERS.length} columns but found ${values.length}`
      );
      continue;
    }

    rows.push({
      rowNumber,
      date: values[0],
      startTime: values[1],
      endTime: values[2],
      arrivalTime: values[3],
      shortLabel: values[4],
      eventType: values[5],
      division: values[6],
      homeTeam: values[7],
      awayTeam: values[8],
      location: values[9],
    });
  }

  return { rows, errors };
}

/**
 * Basic client-side validation for fast feedback
 */
export function validateRowsClientSide(
  rows: TeamSnapImportRow[]
): { rowNumber: number; field: string; message: string }[] {
  const errors: { rowNumber: number; field: string; message: string }[] = [];

  for (const row of rows) {
    // Date format: m/d/yyyy
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(row.date)) {
      errors.push({
        rowNumber: row.rowNumber,
        field: 'date',
        message: 'Invalid date format. Expected m/d/yyyy',
      });
    }

    // Time format: h:mm:ss AM/PM
    const timeRegex = /^\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$/i;
    if (!timeRegex.test(row.startTime)) {
      errors.push({
        rowNumber: row.rowNumber,
        field: 'startTime',
        message: 'Invalid time format. Expected h:mm:ss AM/PM',
      });
    }
    if (!timeRegex.test(row.endTime)) {
      errors.push({
        rowNumber: row.rowNumber,
        field: 'endTime',
        message: 'Invalid time format. Expected h:mm:ss AM/PM',
      });
    }

    // Event type must be Game or Practice
    const eventType = row.eventType.trim().toLowerCase();
    if (eventType !== 'game' && eventType !== 'practice') {
      errors.push({
        rowNumber: row.rowNumber,
        field: 'eventType',
        message: 'Event type must be "Game" or "Practice"',
      });
    }
  }

  return errors;
}
