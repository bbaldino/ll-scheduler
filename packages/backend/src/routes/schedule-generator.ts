import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { GenerateScheduleRequest, EvaluateScheduleRequest, CompareSchedulesRequest } from '@ll-scheduler/shared';
import { generateSchedule } from '../services/schedule-generator/index.js';
import { evaluateSchedule, evaluateSavedSchedule, compareSchedules } from '../services/schedule-evaluator.js';
import {
  saveScheduleGenerationLog,
  getLatestScheduleGenerationLog,
  listScheduleGenerationLogs,
} from '../services/schedule-generation-logs.js';

const router = new Hono<{ Bindings: Env }>();

// POST /api/schedule-generator/generate - Generate a schedule for a season
router.post('/generate', async (c) => {
  try {
    const request: GenerateScheduleRequest = await c.req.json();

    if (!request.seasonId) {
      return c.json({ error: 'seasonId is required' }, 400);
    }

    const result = await generateSchedule(c.env.DB, request);
    console.log('Schedule generation complete:', result.success ? 'SUCCESS' : 'FAILED', '- Events:', result.eventsCreated);

    // Save the generation log
    try {
      await saveScheduleGenerationLog(c.env.DB, request.seasonId, result);
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

    if (!request.seasonId) {
      return c.json({ error: 'seasonId is required' }, 400);
    }

    const result = await evaluateSchedule(c.env.DB, request.seasonId);
    return c.json(result);
  } catch (error) {
    console.error('Error evaluating schedule:', error);
    return c.json({ error: 'Failed to evaluate schedule' }, 500);
  }
});

// POST /api/schedule-generator/evaluate-saved/:savedScheduleId - Evaluate a saved schedule
router.post('/evaluate-saved/:savedScheduleId', async (c) => {
  try {
    const savedScheduleId = c.req.param('savedScheduleId');

    if (!savedScheduleId) {
      return c.json({ error: 'savedScheduleId is required' }, 400);
    }

    const result = await evaluateSavedSchedule(c.env.DB, savedScheduleId);
    return c.json(result);
  } catch (error) {
    console.error('Error evaluating saved schedule:', error);
    const message = error instanceof Error ? error.message : 'Failed to evaluate saved schedule';
    return c.json({ error: message }, 500);
  }
});

// POST /api/schedule-generator/compare - Compare current schedule with a saved schedule
router.post('/compare', async (c) => {
  try {
    const request: CompareSchedulesRequest = await c.req.json();

    if (!request.seasonId) {
      return c.json({ error: 'seasonId is required' }, 400);
    }

    if (!request.savedScheduleId) {
      return c.json({ error: 'savedScheduleId is required' }, 400);
    }

    const result = await compareSchedules(c.env.DB, request.seasonId, request.savedScheduleId);
    return c.json(result);
  } catch (error) {
    console.error('Error comparing schedules:', error);
    const message = error instanceof Error ? error.message : 'Failed to compare schedules';
    return c.json({ error: message }, 500);
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
