import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { GenerateScheduleRequest, EvaluateScheduleRequest } from '@ll-scheduler/shared';
import { generateSchedule } from '../services/schedule-generator/index.js';
import { evaluateSchedule } from '../services/schedule-evaluator.js';

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

// POST /api/schedule-generator/evaluate - Evaluate a generated schedule
router.post('/evaluate', async (c) => {
  try {
    const request: EvaluateScheduleRequest = await c.req.json();

    if (!request.periodIds || request.periodIds.length === 0) {
      return c.json({ error: 'periodIds array is required and must not be empty' }, 400);
    }

    const result = await evaluateSchedule(c.env.DB, request.periodIds);
    return c.json(result);
  } catch (error) {
    console.error('Error evaluating schedule:', error);
    return c.json({ error: 'Failed to evaluate schedule' }, 500);
  }
});

export default router;
