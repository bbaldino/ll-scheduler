import { Hono } from 'hono';
import type { Env } from '../index.js';
import { exportToTeamSnapFormat, teamSnapRowsToCsv, exportToTeamSnapBulk } from '../services/teamsnap-export.js';
import { createZip } from '../utils/zip.js';

const router = new Hono<{ Bindings: Env }>();

/**
 * GET /api/export/teamsnap
 * Export scheduled events in TeamSnap CSV format
 *
 * Query params:
 * - seasonId (required): The season to export
 * - divisionId (optional): Filter by division
 * - teamId (optional): Filter by team
 */
router.get('/teamsnap', async (c) => {
  const seasonId = c.req.query('seasonId');
  const divisionId = c.req.query('divisionId');
  const teamId = c.req.query('teamId');

  if (!seasonId) {
    return c.json({ error: 'seasonId is required' }, 400);
  }

  try {
    const rows = await exportToTeamSnapFormat(c.env.DB, {
      seasonId,
      divisionId: divisionId || undefined,
      teamId: teamId || undefined,
    });

    const csv = teamSnapRowsToCsv(rows);

    // Return as CSV file download
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="schedule-export-teamsnap.csv"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return c.json({ error: 'Failed to export schedule' }, 500);
  }
});

/**
 * GET /api/export/teamsnap/bulk
 * Export all teams' schedules as a ZIP file with one CSV per team
 *
 * Query params:
 * - seasonId (required): The season to export
 */
router.get('/teamsnap/bulk', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId is required' }, 400);
  }

  try {
    const entries = await exportToTeamSnapBulk(c.env.DB, seasonId);

    if (entries.length === 0) {
      return c.json({ error: 'No scheduled events found for this season' }, 404);
    }

    const zipBuffer = createZip(entries);

    return new Response(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="teamsnap-schedules.zip"`,
      },
    });
  } catch (error) {
    console.error('Bulk export error:', error);
    return c.json({ error: 'Failed to export schedules' }, 500);
  }
});

export default router;
