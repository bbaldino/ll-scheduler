import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { CreateBattingCageInput, UpdateBattingCageInput } from '@ll-scheduler/shared';
import {
  listBattingCages,
  getBattingCageById,
  createBattingCage,
  updateBattingCage,
  deleteBattingCage,
} from '../services/batting-cages.js';

const app = new Hono<{ Bindings: Env }>();

// GET /api/batting-cages - List all batting cages
app.get('/', async (c) => {
  const cages = await listBattingCages(c.env.DB);
  return c.json(cages);
});

// GET /api/batting-cages/:id - Get a specific batting cage
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const cage = await getBattingCageById(c.env.DB, id);

  if (!cage) {
    return c.json({ error: 'Batting cage not found' }, 404);
  }

  return c.json(cage);
});

// POST /api/batting-cages - Create a new batting cage
app.post('/', async (c) => {
  const body = await c.req.json<CreateBattingCageInput>();
  const cage = await createBattingCage(c.env.DB, body);
  return c.json(cage, 201);
});

// PUT /api/batting-cages/:id - Update a batting cage
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateBattingCageInput>();
  const cage = await updateBattingCage(c.env.DB, id, body);

  if (!cage) {
    return c.json({ error: 'Batting cage not found' }, 404);
  }

  return c.json(cage);
});

// DELETE /api/batting-cages/:id - Delete a batting cage
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteBattingCage(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Batting cage not found' }, 404);
  }

  return c.json({ success: true });
});

export default app;
