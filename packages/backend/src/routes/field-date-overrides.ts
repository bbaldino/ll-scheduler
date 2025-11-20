import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { CreateFieldDateOverrideInput, UpdateFieldDateOverrideInput } from '@ll-scheduler/shared';
import {
  listFieldDateOverrides,
  getFieldDateOverrideById,
  createFieldDateOverride,
  updateFieldDateOverride,
  deleteFieldDateOverride,
} from '../services/field-date-overrides.js';

const app = new Hono<{ Bindings: Env }>();

// GET /api/field-date-overrides?fieldId=xxx - List overrides for a field
app.get('/', async (c) => {
  const fieldId = c.req.query('fieldId');
  if (!fieldId) {
    return c.json({ error: 'fieldId query parameter is required' }, 400);
  }

  const overrides = await listFieldDateOverrides(c.env.DB, fieldId);
  return c.json(overrides);
});

// GET /api/field-date-overrides/:id - Get a specific override
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const override = await getFieldDateOverrideById(c.env.DB, id);

  if (!override) {
    return c.json({ error: 'Field date override not found' }, 404);
  }

  return c.json(override);
});

// POST /api/field-date-overrides - Create a new override
app.post('/', async (c) => {
  const body = await c.req.json<CreateFieldDateOverrideInput>();
  const override = await createFieldDateOverride(c.env.DB, body);
  return c.json(override, 201);
});

// PUT /api/field-date-overrides/:id - Update an override
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateFieldDateOverrideInput>();
  const override = await updateFieldDateOverride(c.env.DB, id, body);

  if (!override) {
    return c.json({ error: 'Field date override not found' }, 404);
  }

  return c.json(override);
});

// DELETE /api/field-date-overrides/:id - Delete an override
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteFieldDateOverride(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Field date override not found' }, 404);
  }

  return c.json({ success: true });
});

export default app;
