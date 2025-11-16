import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as divisionConfigsService from '../services/division-configs.js';
import type { CreateDivisionConfigInput, UpdateDivisionConfigInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/division-configs?seasonId=xyz - List configs for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId query parameter is required' }, 400);
  }

  const configs = await divisionConfigsService.listDivisionConfigsBySeasonId(c.env.DB, seasonId);
  return c.json(configs);
});

// GET /api/division-configs/:id - Get a specific config
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const config = await divisionConfigsService.getDivisionConfigById(c.env.DB, id);

  if (!config) {
    return c.json({ error: 'Division config not found' }, 404);
  }

  return c.json(config);
});

// POST /api/division-configs - Create a new config
router.post('/', async (c) => {
  const input: CreateDivisionConfigInput = await c.req.json();

  if (
    !input.divisionId ||
    !input.seasonId ||
    !input.practicesPerWeek ||
    !input.practiceDurationHours
  ) {
    return c.json(
      {
        error:
          'Missing required fields: divisionId, seasonId, practicesPerWeek, practiceDurationHours',
      },
      400
    );
  }

  const config = await divisionConfigsService.createDivisionConfig(c.env.DB, input);
  return c.json(config, 201);
});

// PUT /api/division-configs/:id - Update a config
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateDivisionConfigInput = await c.req.json();

  const config = await divisionConfigsService.updateDivisionConfig(c.env.DB, id, input);

  if (!config) {
    return c.json({ error: 'Division config not found' }, 404);
  }

  return c.json(config);
});

// DELETE /api/division-configs/:id - Delete a config
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await divisionConfigsService.deleteDivisionConfig(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Division config not found' }, 404);
  }

  return c.json({ message: 'Division config deleted successfully' });
});

export default router;
