import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { CreateScheduledEventInput, UpdateScheduledEventInput, ScheduledEventQuery } from '@ll-scheduler/shared';
import {
  listScheduledEvents,
  getScheduledEventById,
  createScheduledEvent,
  updateScheduledEvent,
  deleteScheduledEvent,
} from '../services/scheduled-events.js';

const router = new Hono<{ Bindings: Env }>();

// GET /api/scheduled-events - List scheduled events with optional filters
router.get('/', async (c) => {
  const query: ScheduledEventQuery = {
    seasonPhaseId: c.req.query('seasonPhaseId'),
    divisionId: c.req.query('divisionId'),
    teamId: c.req.query('teamId'),
    fieldId: c.req.query('fieldId'),
    cageId: c.req.query('cageId'),
    eventType: c.req.query('eventType') as any,
    status: c.req.query('status') as any,
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  };

  const events = await listScheduledEvents(c.env.DB, query);
  return c.json(events);
});

// GET /api/scheduled-events/:id - Get a specific scheduled event
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const event = await getScheduledEventById(c.env.DB, id);

  if (!event) {
    return c.json({ error: 'Scheduled event not found' }, 404);
  }

  return c.json(event);
});

// POST /api/scheduled-events - Create a new scheduled event
router.post('/', async (c) => {
  const input: CreateScheduledEventInput = await c.req.json();
  const event = await createScheduledEvent(c.env.DB, input);
  return c.json(event, 201);
});

// PUT /api/scheduled-events/:id - Update a scheduled event
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateScheduledEventInput = await c.req.json();
  const event = await updateScheduledEvent(c.env.DB, id, input);

  if (!event) {
    return c.json({ error: 'Scheduled event not found' }, 404);
  }

  return c.json(event);
});

// DELETE /api/scheduled-events/:id - Delete a scheduled event
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteScheduledEvent(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Scheduled event not found' }, 404);
  }

  return c.json({ success: true });
});

export default router;
