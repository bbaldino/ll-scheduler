import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as seasonPhasesService from '../services/season-phases.js';
import type { CreateSeasonPhaseInput, UpdateSeasonPhaseInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/season-phases?seasonId=xyz - List phases for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId query parameter is required' }, 400);
  }

  const phases = await seasonPhasesService.listSeasonPhases(c.env.DB, seasonId);
  return c.json(phases);
});

// GET /api/season-phases/:id - Get a specific phase
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const phase = await seasonPhasesService.getSeasonPhaseById(c.env.DB, id);

  if (!phase) {
    return c.json({ error: 'Season phase not found' }, 404);
  }

  return c.json(phase);
});

// POST /api/season-phases - Create a new phase
router.post('/', async (c) => {
  const input: CreateSeasonPhaseInput = await c.req.json();

  // Validation
  if (!input.seasonId || !input.name || !input.phaseType || !input.startDate || !input.endDate) {
    return c.json(
      {
        error: 'Missing required fields: seasonId, name, phaseType, startDate, endDate',
      },
      400
    );
  }

  const phase = await seasonPhasesService.createSeasonPhase(c.env.DB, input);
  return c.json(phase, 201);
});

// PUT /api/season-phases/:id - Update a phase
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateSeasonPhaseInput = await c.req.json();

  const phase = await seasonPhasesService.updateSeasonPhase(c.env.DB, id, input);

  if (!phase) {
    return c.json({ error: 'Season phase not found' }, 404);
  }

  return c.json(phase);
});

// DELETE /api/season-phases/:id - Delete a phase
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await seasonPhasesService.deleteSeasonPhase(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Season phase not found' }, 404);
  }

  return c.json({ message: 'Season phase deleted successfully' });
});

export default router;
