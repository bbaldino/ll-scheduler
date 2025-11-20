import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { CreateCageAvailabilityInput, UpdateCageAvailabilityInput } from '@ll-scheduler/shared';
import {
  listCageAvailabilities,
  getCageAvailabilityById,
  createCageAvailability,
  updateCageAvailability,
  deleteCageAvailability,
} from '../services/cage-availabilities.js';

const app = new Hono<{ Bindings: Env }>();

// GET /api/cage-availabilities?cageId=xxx - List availabilities for a cage
app.get('/', async (c) => {
  const cageId = c.req.query('cageId');
  if (!cageId) {
    return c.json({ error: 'cageId query parameter is required' }, 400);
  }

  const availabilities = await listCageAvailabilities(c.env.DB, cageId);
  return c.json(availabilities);
});

// GET /api/cage-availabilities/:id - Get a specific availability
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const availability = await getCageAvailabilityById(c.env.DB, id);

  if (!availability) {
    return c.json({ error: 'Cage availability not found' }, 404);
  }

  return c.json(availability);
});

// POST /api/cage-availabilities - Create a new availability
app.post('/', async (c) => {
  const body = await c.req.json<CreateCageAvailabilityInput>();
  const availability = await createCageAvailability(c.env.DB, body);
  return c.json(availability, 201);
});

// PUT /api/cage-availabilities/:id - Update an availability
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateCageAvailabilityInput>();
  const availability = await updateCageAvailability(c.env.DB, id, body);

  if (!availability) {
    return c.json({ error: 'Cage availability not found' }, 404);
  }

  return c.json(availability);
});

// DELETE /api/cage-availabilities/:id - Delete an availability
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteCageAvailability(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Cage availability not found' }, 404);
  }

  return c.json({ success: true });
});

export default app;
