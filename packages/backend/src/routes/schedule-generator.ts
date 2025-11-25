import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { GenerateScheduleRequest } from '@ll-scheduler/shared';
import { generateSchedule } from '../services/schedule-generator/index.js';

const router = new Hono<{ Bindings: Env }>();

// POST /api/schedule-generator/generate - Generate a schedule for selected season periods
router.post('/generate', async (c) => {
  try {
    console.log('=== SCHEDULE GENERATION REQUEST RECEIVED ===');
    const request: GenerateScheduleRequest = await c.req.json();
    console.log('Request body:', JSON.stringify(request, null, 2));

    if (!request.periodIds || request.periodIds.length === 0) {
      console.log('ERROR: periodIds is missing or empty');
      return c.json({ error: 'periodIds array is required and must not be empty' }, 400);
    }

    console.log('Calling generateSchedule with periodIds:', request.periodIds);
    const result = await generateSchedule(c.env.DB, request);
    console.log('generateSchedule result:', JSON.stringify(result, null, 2));
    return c.json(result);
  } catch (error) {
    console.error('Error generating schedule:', error);
    return c.json({ error: 'Failed to generate schedule' }, 500);
  }
});

export default router;
