import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { CreateSavedScheduleInput } from '@ll-scheduler/shared';
import {
  listSavedSchedules,
  getSavedScheduleById,
  saveSchedule,
  restoreSchedule,
  deleteSavedSchedule,
} from '../services/saved-schedules.js';

const router = new Hono<{ Bindings: Env }>();

// GET /api/saved-schedules - List saved schedules for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId is required' }, 400);
  }

  const schedules = await listSavedSchedules(c.env.DB, seasonId);
  return c.json(schedules);
});

// GET /api/saved-schedules/:id - Get a specific saved schedule
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const schedule = await getSavedScheduleById(c.env.DB, id);

  if (!schedule) {
    return c.json({ error: 'Saved schedule not found' }, 404);
  }

  return c.json(schedule);
});

// POST /api/saved-schedules - Save the current schedule
router.post('/', async (c) => {
  const input: CreateSavedScheduleInput = await c.req.json();

  if (!input.seasonId) {
    return c.json({ error: 'seasonId is required' }, 400);
  }
  if (!input.name || input.name.trim() === '') {
    return c.json({ error: 'name is required' }, 400);
  }

  const schedule = await saveSchedule(c.env.DB, {
    seasonId: input.seasonId,
    name: input.name.trim(),
    description: input.description?.trim(),
  });

  return c.json(schedule, 201);
});

// POST /api/saved-schedules/:id/restore - Restore a saved schedule
router.post('/:id/restore', async (c) => {
  const id = c.req.param('id');

  try {
    const result = await restoreSchedule(c.env.DB, id);
    return c.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Saved schedule not found') {
      return c.json({ error: 'Saved schedule not found' }, 404);
    }
    throw error;
  }
});

// DELETE /api/saved-schedules/:id - Delete a saved schedule
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteSavedSchedule(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Saved schedule not found' }, 404);
  }

  return c.json({ success: true });
});

export default router;
