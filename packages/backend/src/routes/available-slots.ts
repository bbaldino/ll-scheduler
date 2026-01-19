import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getAvailableSlots } from '../services/available-slots.js';

const app = new Hono<{ Bindings: Env }>();

// GET /api/available-slots?seasonId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&divisionId=xxx
app.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const divisionId = c.req.query('divisionId');

  if (!seasonId) {
    return c.json({ error: 'seasonId query parameter is required' }, 400);
  }
  if (!startDate) {
    return c.json({ error: 'startDate query parameter is required' }, 400);
  }
  if (!endDate) {
    return c.json({ error: 'endDate query parameter is required' }, 400);
  }

  const slots = await getAvailableSlots(
    c.env.DB,
    seasonId,
    startDate,
    endDate,
    divisionId || undefined
  );

  return c.json(slots);
});

export default app;
