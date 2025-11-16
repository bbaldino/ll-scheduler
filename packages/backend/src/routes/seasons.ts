import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as seasonsService from '../services/seasons.js';
import type { CreateSeasonInput, UpdateSeasonInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/seasons - List all seasons
router.get('/', async (c) => {
  const seasons = await seasonsService.listSeasons(c.env.DB);
  return c.json(seasons);
});

// GET /api/seasons/:id - Get a specific season
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const season = await seasonsService.getSeasonById(c.env.DB, id);

  if (!season) {
    return c.json({ error: 'Season not found' }, 404);
  }

  return c.json(season);
});

// POST /api/seasons - Create a new season
router.post('/', async (c) => {
  const input: CreateSeasonInput = await c.req.json();

  // Validation
  if (!input.name || !input.startDate || !input.endDate) {
    return c.json({ error: 'Missing required fields: name, startDate, endDate' }, 400);
  }

  const season = await seasonsService.createSeason(c.env.DB, input);
  return c.json(season, 201);
});

// PUT /api/seasons/:id - Update a season
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateSeasonInput = await c.req.json();

  const season = await seasonsService.updateSeason(c.env.DB, id, input);

  if (!season) {
    return c.json({ error: 'Season not found' }, 404);
  }

  return c.json(season);
});

// DELETE /api/seasons/:id - Delete a season
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await seasonsService.deleteSeason(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Season not found' }, 404);
  }

  return c.json({ message: 'Season deleted successfully' });
});

export default router;
