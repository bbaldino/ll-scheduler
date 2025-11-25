import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as seasonPeriodsService from '../services/season-periods.js';
import type { CreateSeasonPeriodInput, UpdateSeasonPeriodInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/season-periods?seasonId=xyz - List season periods for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId query parameter is required' }, 400);
  }

  const periods = await seasonPeriodsService.listSeasonPeriods(c.env.DB, seasonId);
  return c.json(periods);
});

// GET /api/season-periods/:id - Get a specific season period
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const period = await seasonPeriodsService.getSeasonPeriodById(c.env.DB, id);

  if (!period) {
    return c.json({ error: 'Season period not found' }, 404);
  }

  return c.json(period);
});

// POST /api/season-periods - Create a new season period
router.post('/', async (c) => {
  const input: CreateSeasonPeriodInput = await c.req.json();

  // Validation
  if (!input.seasonId || !input.name || !input.startDate || !input.endDate || !input.eventTypes || input.eventTypes.length === 0) {
    return c.json(
      {
        error: 'Missing required fields: seasonId, name, startDate, endDate, eventTypes (non-empty array)',
      },
      400
    );
  }

  // Validate eventTypes values
  const validEventTypes = ['game', 'practice', 'cage'];
  for (const eventType of input.eventTypes) {
    if (!validEventTypes.includes(eventType)) {
      return c.json(
        { error: `Invalid event type: ${eventType}. Valid types are: ${validEventTypes.join(', ')}` },
        400
      );
    }
  }

  const period = await seasonPeriodsService.createSeasonPeriod(c.env.DB, input);
  return c.json(period, 201);
});

// PUT /api/season-periods/:id - Update a season period
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateSeasonPeriodInput = await c.req.json();

  // Validate eventTypes if provided
  if (input.eventTypes !== undefined) {
    if (input.eventTypes.length === 0) {
      return c.json({ error: 'eventTypes cannot be empty' }, 400);
    }
    const validEventTypes = ['game', 'practice', 'cage'];
    for (const eventType of input.eventTypes) {
      if (!validEventTypes.includes(eventType)) {
        return c.json(
          { error: `Invalid event type: ${eventType}. Valid types are: ${validEventTypes.join(', ')}` },
          400
        );
      }
    }
  }

  const period = await seasonPeriodsService.updateSeasonPeriod(c.env.DB, id, input);

  if (!period) {
    return c.json({ error: 'Season period not found' }, 404);
  }

  return c.json(period);
});

// DELETE /api/season-periods/:id - Delete a season period
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await seasonPeriodsService.deleteSeasonPeriod(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Season period not found' }, 404);
  }

  return c.json({ message: 'Season period deleted successfully' });
});

export default router;
