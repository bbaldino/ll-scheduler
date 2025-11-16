import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as fieldsService from '../services/fields.js';
import type { CreateFieldInput, UpdateFieldInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/fields?seasonId=xyz - List fields for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId query parameter is required' }, 400);
  }

  const fields = await fieldsService.listFields(c.env.DB, seasonId);
  return c.json(fields);
});

// GET /api/fields/:id - Get a specific field
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const field = await fieldsService.getFieldById(c.env.DB, id);

  if (!field) {
    return c.json({ error: 'Field not found' }, 404);
  }

  return c.json(field);
});

// POST /api/fields - Create a new field
router.post('/', async (c) => {
  const input: CreateFieldInput = await c.req.json();

  // Validation
  if (!input.seasonId || !input.name) {
    return c.json({ error: 'Missing required fields: seasonId, name' }, 400);
  }

  const field = await fieldsService.createField(c.env.DB, input);
  return c.json(field, 201);
});

// PUT /api/fields/:id - Update a field
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateFieldInput = await c.req.json();

  const field = await fieldsService.updateField(c.env.DB, id, input);

  if (!field) {
    return c.json({ error: 'Field not found' }, 404);
  }

  return c.json(field);
});

// DELETE /api/fields/:id - Delete a field
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await fieldsService.deleteField(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Field not found' }, 404);
  }

  return c.json({ message: 'Field deleted successfully' });
});

export default router;
