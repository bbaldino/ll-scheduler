import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { ValidateImportInput, ExecuteImportInput } from '@ll-scheduler/shared';
import { validateAndResolveRows, executeImport } from '../services/teamsnap-import.js';

const router = new Hono<{ Bindings: Env }>();

// POST /api/import/validate - Validate import rows and resolve names to IDs
router.post('/validate', async (c) => {
  const input: ValidateImportInput = await c.req.json();

  if (!input.seasonId) {
    return c.json({ error: 'seasonId is required' }, 400);
  }

  if (!input.rows || !Array.isArray(input.rows)) {
    return c.json({ error: 'rows is required and must be an array' }, 400);
  }

  if (input.rows.length === 0) {
    return c.json({ error: 'No rows provided' }, 400);
  }

  try {
    const result = await validateAndResolveRows(c.env.DB, input.seasonId, input.rows);
    return c.json(result);
  } catch (error) {
    console.error('Validation error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Validation failed' },
      500
    );
  }
});

// POST /api/import/execute - Execute the import
router.post('/execute', async (c) => {
  const input: ExecuteImportInput = await c.req.json();

  if (!input.seasonId) {
    return c.json({ error: 'seasonId is required' }, 400);
  }

  if (!input.rows || !Array.isArray(input.rows)) {
    return c.json({ error: 'rows is required and must be an array' }, 400);
  }

  if (input.rows.length === 0) {
    return c.json({ error: 'No rows provided' }, 400);
  }

  if (!input.options) {
    return c.json({ error: 'options is required' }, 400);
  }

  if (!['merge', 'overwrite'].includes(input.options.mode)) {
    return c.json({ error: 'options.mode must be "merge" or "overwrite"' }, 400);
  }

  if (input.options.mode === 'overwrite' && (!input.options.divisionIds || input.options.divisionIds.length === 0)) {
    return c.json({ error: 'options.divisionIds is required for overwrite mode' }, 400);
  }

  try {
    const result = await executeImport(c.env.DB, input.seasonId, input.rows, input.options);
    return c.json(result);
  } catch (error) {
    console.error('Import execution error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      500
    );
  }
});

export default router;
