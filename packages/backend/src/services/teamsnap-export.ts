import type {
  TeamSnapExportRow,
  TeamSnapExportOptions,
  TEAMSNAP_CSV_HEADERS,
  ScheduledEvent,
  Division,
  Team,
  Field,
  BattingCage,
  DivisionConfig,
} from '@ll-scheduler/shared';
import { listScheduledEvents } from './scheduled-events.js';
import { listDivisionConfigsBySeasonId } from './division-configs.js';

/**
 * Convert 24-hour time (HH:MM) to TeamSnap format (hh:mm:ss AM/PM)
 */
function formatTimeForTeamSnap(time24: string): string {
  const [hoursStr, minutesStr] = time24.split(':');
  let hours = parseInt(hoursStr, 10);
  const minutes = minutesStr;

  const period = hours >= 12 ? 'PM' : 'AM';

  if (hours === 0) {
    hours = 12;
  } else if (hours > 12) {
    hours = hours - 12;
  }

  return `${hours}:${minutes}:00 ${period}`;
}

/**
 * Convert ISO date (YYYY-MM-DD) to TeamSnap format (mm/dd/yyyy)
 */
function formatDateForTeamSnap(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  // Remove leading zeros for single digit month/day
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  return `${m}/${d}/${year}`;
}

/**
 * Get arrival time in minutes based on event type and division config
 */
function getArrivalTime(
  eventType: string,
  divisionConfig: DivisionConfig | undefined
): number {
  if (eventType === 'game') {
    // Game arrival time is stored in hours, convert to minutes
    return Math.round((divisionConfig?.gameArriveBeforeHours || 1) * 60);
  } else {
    // Practice/cage arrival time is stored in minutes
    return divisionConfig?.practiceArriveBeforeMinutes ?? 10;
  }
}

/**
 * Get short label based on event type
 */
function getShortLabel(eventType: string): string {
  switch (eventType) {
    case 'game':
      return '';
    case 'cage':
      return 'Batting Cages';
    case 'practice':
      return 'Field Practice';
    default:
      return '';
  }
}

/**
 * Get TeamSnap event type
 */
function getTeamSnapEventType(eventType: string): 'Game' | 'Practice' {
  return eventType === 'game' ? 'Game' : 'Practice';
}

/**
 * Export scheduled events to TeamSnap CSV format
 */
export async function exportToTeamSnapFormat(
  db: D1Database,
  options: TeamSnapExportOptions
): Promise<TeamSnapExportRow[]> {
  const { seasonId, divisionId, teamId } = options;

  // Fetch all events for the season
  const events = await listScheduledEvents(db, {
    seasonId,
    divisionId,
    teamId,
  });

  if (events.length === 0) {
    return [];
  }

  // Fetch all divisions
  const divisionsResult = await db
    .prepare('SELECT id, name FROM divisions')
    .all<{ id: string; name: string }>();
  const divisionsMap = new Map<string, string>();
  for (const d of divisionsResult.results || []) {
    divisionsMap.set(d.id, d.name);
  }

  // Fetch all teams for this season
  const teamsResult = await db
    .prepare('SELECT id, name FROM teams WHERE season_id = ?')
    .bind(seasonId)
    .all<{ id: string; name: string }>();
  const teamsMap = new Map<string, string>();
  for (const t of teamsResult.results || []) {
    teamsMap.set(t.id, t.name);
  }

  // Fetch all fields
  const fieldsResult = await db
    .prepare('SELECT id, name FROM fields')
    .all<{ id: string; name: string }>();
  const fieldsMap = new Map<string, string>();
  for (const f of fieldsResult.results || []) {
    fieldsMap.set(f.id, f.name);
  }

  // Fetch all cages
  const cagesResult = await db
    .prepare('SELECT id, name FROM batting_cages')
    .all<{ id: string; name: string }>();
  const cagesMap = new Map<string, string>();
  for (const c of cagesResult.results || []) {
    cagesMap.set(c.id, c.name);
  }

  // Fetch division configs for arrival times
  const divisionConfigs = await listDivisionConfigsBySeasonId(db, seasonId);
  const configsMap = new Map<string, DivisionConfig>();
  for (const config of divisionConfigs) {
    configsMap.set(config.divisionId, config);
  }

  // Convert events to TeamSnap format
  const rows: TeamSnapExportRow[] = [];

  for (const event of events) {
    const divisionName = divisionsMap.get(event.divisionId) || 'Unknown Division';
    const divisionConfig = configsMap.get(event.divisionId);

    // Determine home team, away team, and location
    let homeTeam = '';
    let awayTeam = '';
    let location = '';

    if (event.eventType === 'game') {
      homeTeam = event.homeTeamId ? (teamsMap.get(event.homeTeamId) || 'Unknown Team') : '';
      awayTeam = event.awayTeamId ? (teamsMap.get(event.awayTeamId) || 'Unknown Team') : '';
      location = event.fieldId ? (fieldsMap.get(event.fieldId) || 'Unknown Field') : '';
    } else if (event.eventType === 'practice') {
      homeTeam = event.teamId ? (teamsMap.get(event.teamId) || 'Unknown Team') : '';
      awayTeam = '';
      location = event.fieldId ? (fieldsMap.get(event.fieldId) || 'Unknown Field') : '';
    } else if (event.eventType === 'cage') {
      homeTeam = event.teamId ? (teamsMap.get(event.teamId) || 'Unknown Team') : '';
      awayTeam = '';
      location = event.cageId ? (cagesMap.get(event.cageId) || 'Unknown Cage') : '';
    }

    rows.push({
      date: formatDateForTeamSnap(event.date),
      startTime: formatTimeForTeamSnap(event.startTime),
      endTime: formatTimeForTeamSnap(event.endTime),
      arrivalTime: getArrivalTime(event.eventType, divisionConfig),
      shortLabel: getShortLabel(event.eventType),
      eventType: getTeamSnapEventType(event.eventType),
      division: divisionName,
      homeTeam,
      awayTeam,
      location,
    });
  }

  return rows;
}

/**
 * Convert TeamSnap export rows to CSV string
 */
export function teamSnapRowsToCsv(rows: TeamSnapExportRow[]): string {
  const headers = [
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
  ];

  const csvLines: string[] = [headers.join(',')];

  for (const row of rows) {
    const values = [
      row.date,
      row.startTime,
      row.endTime,
      row.arrivalTime.toString(),
      row.shortLabel,
      row.eventType,
      escapeForCsv(row.division),
      escapeForCsv(row.homeTeam),
      escapeForCsv(row.awayTeam),
      escapeForCsv(row.location),
    ];
    csvLines.push(values.join(','));
  }

  return csvLines.join('\n');
}

/**
 * Escape a value for CSV (wrap in quotes if contains comma, quote, or newline)
 */
function escapeForCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Sanitize a string for use in a filename
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Export result for bulk export - one entry per team
 */
export interface BulkExportEntry {
  filename: string;
  content: string;
}

/**
 * Bulk export scheduled events to TeamSnap CSV format - one CSV per team
 */
export async function exportToTeamSnapBulk(
  db: D1Database,
  seasonId: string
): Promise<BulkExportEntry[]> {
  // Fetch all events for the season
  const events = await listScheduledEvents(db, { seasonId });

  if (events.length === 0) {
    return [];
  }

  // Fetch all divisions
  const divisionsResult = await db
    .prepare('SELECT id, name FROM divisions')
    .all<{ id: string; name: string }>();
  const divisionsMap = new Map<string, string>();
  for (const d of divisionsResult.results || []) {
    divisionsMap.set(d.id, d.name);
  }

  // Fetch all teams for this season (with division info)
  const teamsResult = await db
    .prepare('SELECT id, name, division_id FROM teams WHERE season_id = ?')
    .bind(seasonId)
    .all<{ id: string; name: string; division_id: string }>();
  const teamsMap = new Map<string, { name: string; divisionId: string }>();
  for (const t of teamsResult.results || []) {
    teamsMap.set(t.id, { name: t.name, divisionId: t.division_id });
  }

  // Fetch all fields
  const fieldsResult = await db
    .prepare('SELECT id, name FROM fields')
    .all<{ id: string; name: string }>();
  const fieldsMap = new Map<string, string>();
  for (const f of fieldsResult.results || []) {
    fieldsMap.set(f.id, f.name);
  }

  // Fetch all cages
  const cagesResult = await db
    .prepare('SELECT id, name FROM batting_cages')
    .all<{ id: string; name: string }>();
  const cagesMap = new Map<string, string>();
  for (const c of cagesResult.results || []) {
    cagesMap.set(c.id, c.name);
  }

  // Fetch division configs for arrival times
  const divisionConfigs = await listDivisionConfigsBySeasonId(db, seasonId);
  const configsMap = new Map<string, DivisionConfig>();
  for (const config of divisionConfigs) {
    configsMap.set(config.divisionId, config);
  }

  // Group events by team
  // For each event, determine which team(s) it belongs to
  const eventsByTeam = new Map<string, typeof events>();

  for (const event of events) {
    const teamIds: string[] = [];

    if (event.eventType === 'game') {
      // Games belong to both home and away teams
      if (event.homeTeamId) teamIds.push(event.homeTeamId);
      if (event.awayTeamId) teamIds.push(event.awayTeamId);
    } else {
      // Practices and cage sessions belong to one team
      if (event.teamId) teamIds.push(event.teamId);
    }

    for (const teamId of teamIds) {
      if (!eventsByTeam.has(teamId)) {
        eventsByTeam.set(teamId, []);
      }
      eventsByTeam.get(teamId)!.push(event);
    }
  }

  // Generate CSV for each team
  const entries: BulkExportEntry[] = [];

  for (const [teamId, teamEvents] of eventsByTeam) {
    const teamInfo = teamsMap.get(teamId);
    if (!teamInfo) continue;

    const divisionName = divisionsMap.get(teamInfo.divisionId) || 'Unknown';
    const teamName = teamInfo.name;

    // Convert events to TeamSnap rows
    const rows: TeamSnapExportRow[] = [];

    for (const event of teamEvents) {
      const eventDivisionName = divisionsMap.get(event.divisionId) || 'Unknown Division';
      const divisionConfig = configsMap.get(event.divisionId);

      let homeTeam = '';
      let awayTeam = '';
      let location = '';

      if (event.eventType === 'game') {
        homeTeam = event.homeTeamId ? (teamsMap.get(event.homeTeamId)?.name || 'Unknown Team') : '';
        awayTeam = event.awayTeamId ? (teamsMap.get(event.awayTeamId)?.name || 'Unknown Team') : '';
        location = event.fieldId ? (fieldsMap.get(event.fieldId) || 'Unknown Field') : '';
      } else if (event.eventType === 'practice') {
        homeTeam = event.teamId ? (teamsMap.get(event.teamId)?.name || 'Unknown Team') : '';
        awayTeam = '';
        location = event.fieldId ? (fieldsMap.get(event.fieldId) || 'Unknown Field') : '';
      } else if (event.eventType === 'cage') {
        homeTeam = event.teamId ? (teamsMap.get(event.teamId)?.name || 'Unknown Team') : '';
        awayTeam = '';
        location = event.cageId ? (cagesMap.get(event.cageId) || 'Unknown Cage') : '';
      }

      rows.push({
        date: formatDateForTeamSnap(event.date),
        startTime: formatTimeForTeamSnap(event.startTime),
        endTime: formatTimeForTeamSnap(event.endTime),
        arrivalTime: getArrivalTime(event.eventType, divisionConfig),
        shortLabel: getShortLabel(event.eventType),
        eventType: getTeamSnapEventType(event.eventType),
        division: eventDivisionName,
        homeTeam,
        awayTeam,
        location,
      });
    }

    // Sort by date then time
    rows.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.startTime.localeCompare(b.startTime);
    });

    const csv = teamSnapRowsToCsv(rows);
    const filename = `${sanitizeFilename(divisionName)}-${sanitizeFilename(teamName)}.csv`;

    entries.push({ filename, content: csv });
  }

  // Sort entries by filename for consistent ordering
  entries.sort((a, b) => a.filename.localeCompare(b.filename));

  return entries;
}
