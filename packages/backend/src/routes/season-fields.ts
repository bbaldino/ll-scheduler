import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as seasonFieldsService from '../services/season-fields.js';
import type { CreateSeasonFieldInput, UpdateSeasonFieldInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/season-fields?seasonId=xyz - List fields for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId query parameter is required' }, 400);
  }

  const seasonFields = await seasonFieldsService.listSeasonFields(c.env.DB, seasonId);
  return c.json(seasonFields);
});

// GET /api/season-fields/:id - Get a specific season field
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const seasonField = await seasonFieldsService.getSeasonFieldById(c.env.DB, id);

  if (!seasonField) {
    return c.json({ error: 'Season field not found' }, 404);
  }

  return c.json(seasonField);
});

// POST /api/season-fields - Add a field to a season
router.post('/', async (c) => {
  const input: CreateSeasonFieldInput = await c.req.json();

  // Validation
  if (!input.seasonId || !input.fieldId) {
    return c.json({ error: 'Missing required fields: seasonId, fieldId' }, 400);
  }

  const seasonField = await seasonFieldsService.createSeasonField(c.env.DB, input);
  return c.json(seasonField, 201);
});

// PUT /api/season-fields/:id - Update a season field (division compatibility)
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateSeasonFieldInput = await c.req.json();

  const seasonField = await seasonFieldsService.updateSeasonField(c.env.DB, id, input);

  if (!seasonField) {
    return c.json({ error: 'Season field not found' }, 404);
  }

  return c.json(seasonField);
});

// DELETE /api/season-fields/:id - Remove a field from a season
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await seasonFieldsService.deleteSeasonField(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Season field not found' }, 404);
  }

  return c.json({ message: 'Field removed from season successfully' });
});

export default router;
