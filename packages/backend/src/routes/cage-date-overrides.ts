import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { CreateCageDateOverrideInput, UpdateCageDateOverrideInput } from '@ll-scheduler/shared';
import {
  listCageDateOverrides,
  getCageDateOverrideById,
  createCageDateOverride,
  updateCageDateOverride,
  deleteCageDateOverride,
} from '../services/cage-date-overrides.js';

const app = new Hono<{ Bindings: Env }>();

// GET /api/cage-date-overrides?seasonCageId=xxx - List overrides for a season cage
app.get('/', async (c) => {
  const seasonCageId = c.req.query('seasonCageId');
  if (!seasonCageId) {
    return c.json({ error: 'seasonCageId query parameter is required' }, 400);
  }

  const overrides = await listCageDateOverrides(c.env.DB, seasonCageId);
  return c.json(overrides);
});

// GET /api/cage-date-overrides/:id - Get a specific override
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const override = await getCageDateOverrideById(c.env.DB, id);

  if (!override) {
    return c.json({ error: 'Cage date override not found' }, 404);
  }

  return c.json(override);
});

// POST /api/cage-date-overrides - Create a new override
app.post('/', async (c) => {
  const body = await c.req.json<CreateCageDateOverrideInput>();
  const override = await createCageDateOverride(c.env.DB, body);
  return c.json(override, 201);
});

// PUT /api/cage-date-overrides/:id - Update an override
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateCageDateOverrideInput>();
  const override = await updateCageDateOverride(c.env.DB, id, body);

  if (!override) {
    return c.json({ error: 'Cage date override not found' }, 404);
  }

  return c.json(override);
});

// DELETE /api/cage-date-overrides/:id - Delete an override
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteCageDateOverride(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Cage date override not found' }, 404);
  }

  return c.json({ success: true });
});

export default app;
