import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as seasonCagesService from '../services/season-cages.js';
import type { CreateSeasonCageInput, UpdateSeasonCageInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/season-cages?seasonId=xyz - List cages for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId query parameter is required' }, 400);
  }

  const seasonCages = await seasonCagesService.listSeasonCages(c.env.DB, seasonId);
  return c.json(seasonCages);
});

// GET /api/season-cages/:id - Get a specific season cage
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const seasonCage = await seasonCagesService.getSeasonCageById(c.env.DB, id);

  if (!seasonCage) {
    return c.json({ error: 'Season cage not found' }, 404);
  }

  return c.json(seasonCage);
});

// POST /api/season-cages - Add a cage to a season
router.post('/', async (c) => {
  const input: CreateSeasonCageInput = await c.req.json();

  // Validation
  if (!input.seasonId || !input.cageId) {
    return c.json({ error: 'Missing required fields: seasonId, cageId' }, 400);
  }

  const seasonCage = await seasonCagesService.createSeasonCage(c.env.DB, input);
  return c.json(seasonCage, 201);
});

// PUT /api/season-cages/:id - Update a season cage (division compatibility)
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateSeasonCageInput = await c.req.json();

  const seasonCage = await seasonCagesService.updateSeasonCage(c.env.DB, id, input);

  if (!seasonCage) {
    return c.json({ error: 'Season cage not found' }, 404);
  }

  return c.json(seasonCage);
});

// DELETE /api/season-cages/:id - Remove a cage from a season
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await seasonCagesService.deleteSeasonCage(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Season cage not found' }, 404);
  }

  return c.json({ message: 'Cage removed from season successfully' });
});

export default router;
