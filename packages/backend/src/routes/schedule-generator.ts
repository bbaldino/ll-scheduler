import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { GenerateScheduleRequest } from '@ll-scheduler/shared';
import { generateSchedule } from '../services/schedule-generator/index.js';

const router = new Hono<{ Bindings: Env }>();

// POST /api/schedule-generator/generate - Generate a schedule for a season phase
router.post('/generate', async (c) => {
  try {
    const request: GenerateScheduleRequest = await c.req.json();

    if (!request.seasonPhaseId) {
      return c.json({ error: 'seasonPhaseId is required' }, 400);
    }

    const result = await generateSchedule(c.env.DB, request);
    return c.json(result);
  } catch (error) {
    console.error('Error generating schedule:', error);
    return c.json({ error: 'Failed to generate schedule' }, 500);
  }
});

export default router;
