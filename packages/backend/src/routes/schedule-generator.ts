import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { GenerateScheduleRequest, EvaluateScheduleRequest } from '@ll-scheduler/shared';
import { generateSchedule } from '../services/schedule-generator/index.js';
import { evaluateSchedule } from '../services/schedule-evaluator.js';
import { getSeasonPeriodsByIds } from '../services/season-periods.js';
import {
  saveScheduleGenerationLog,
  getLatestScheduleGenerationLog,
  listScheduleGenerationLogs,
} from '../services/schedule-generation-logs.js';

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

    // Save the generation log
    try {
      const periods = await getSeasonPeriodsByIds(c.env.DB, request.periodIds);
      if (periods.length > 0) {
        const seasonId = periods[0].seasonId;
        await saveScheduleGenerationLog(c.env.DB, seasonId, request.periodIds, result);
        console.log('Schedule generation log saved');
      }
    } catch (logError) {
      console.error('Failed to save schedule generation log:', logError);
      // Don't fail the request if logging fails
    }

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

// GET /api/schedule-generator/logs/:seasonId/latest - Get the latest generation log for a season
router.get('/logs/:seasonId/latest', async (c) => {
  try {
    const seasonId = c.req.param('seasonId');
    const log = await getLatestScheduleGenerationLog(c.env.DB, seasonId);

    if (!log) {
      return c.json({ error: 'No generation logs found for this season' }, 404);
    }

    return c.json(log);
  } catch (error) {
    console.error('Error fetching latest generation log:', error);
    return c.json({ error: 'Failed to fetch generation log' }, 500);
  }
});

// GET /api/schedule-generator/logs/:seasonId - List generation logs for a season
router.get('/logs/:seasonId', async (c) => {
  try {
    const seasonId = c.req.param('seasonId');
    const limitParam = c.req.query('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 10;

    const logs = await listScheduleGenerationLogs(c.env.DB, seasonId, limit);
    return c.json(logs);
  } catch (error) {
    console.error('Error fetching generation logs:', error);
    return c.json({ error: 'Failed to fetch generation logs' }, 500);
  }
});

export default router;
