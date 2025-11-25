import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { CreateFieldAvailabilityInput, UpdateFieldAvailabilityInput } from '@ll-scheduler/shared';
import {
  listFieldAvailabilities,
  getFieldAvailabilityById,
  createFieldAvailability,
  updateFieldAvailability,
  deleteFieldAvailability,
} from '../services/field-availabilities.js';

const app = new Hono<{ Bindings: Env }>();

// GET /api/field-availabilities?seasonFieldId=xxx - List availabilities for a season field
app.get('/', async (c) => {
  const seasonFieldId = c.req.query('seasonFieldId');
  if (!seasonFieldId) {
    return c.json({ error: 'seasonFieldId query parameter is required' }, 400);
  }

  const availabilities = await listFieldAvailabilities(c.env.DB, seasonFieldId);
  return c.json(availabilities);
});

// GET /api/field-availabilities/:id - Get a specific availability
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const availability = await getFieldAvailabilityById(c.env.DB, id);

  if (!availability) {
    return c.json({ error: 'Field availability not found' }, 404);
  }

  return c.json(availability);
});

// POST /api/field-availabilities - Create a new availability
app.post('/', async (c) => {
  const body = await c.req.json<CreateFieldAvailabilityInput>();
  const availability = await createFieldAvailability(c.env.DB, body);
  return c.json(availability, 201);
});

// PUT /api/field-availabilities/:id - Update an availability
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateFieldAvailabilityInput>();
  const availability = await updateFieldAvailability(c.env.DB, id, body);

  if (!availability) {
    return c.json({ error: 'Field availability not found' }, 404);
  }

  return c.json(availability);
});

// DELETE /api/field-availabilities/:id - Delete an availability
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteFieldAvailability(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Field availability not found' }, 404);
  }

  return c.json({ success: true });
});

export default app;
