import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as divisionsService from '../services/divisions.js';
import type { CreateDivisionInput, UpdateDivisionInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/divisions - List all divisions
router.get('/', async (c) => {
  const divisions = await divisionsService.listDivisions(c.env.DB);
  return c.json(divisions);
});

// GET /api/divisions/:id - Get a specific division
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const division = await divisionsService.getDivisionById(c.env.DB, id);

  if (!division) {
    return c.json({ error: 'Division not found' }, 404);
  }

  return c.json(division);
});

// POST /api/divisions - Create a new division
router.post('/', async (c) => {
  const input: CreateDivisionInput = await c.req.json();

  if (!input.name) {
    return c.json({ error: 'Missing required field: name' }, 400);
  }

  const division = await divisionsService.createDivision(c.env.DB, input);
  return c.json(division, 201);
});

// PUT /api/divisions/:id - Update a division
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateDivisionInput = await c.req.json();

  const division = await divisionsService.updateDivision(c.env.DB, id, input);

  if (!division) {
    return c.json({ error: 'Division not found' }, 404);
  }

  return c.json(division);
});

// DELETE /api/divisions/:id - Delete a division
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await divisionsService.deleteDivision(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Division not found' }, 404);
  }

  return c.json({ message: 'Division deleted successfully' });
});

export default router;
