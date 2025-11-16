import { Hono } from 'hono';
import type { Env } from '../index.js';
import * as teamsService from '../services/teams.js';
import type { CreateTeamInput, UpdateTeamInput } from '@ll-scheduler/shared';

const router = new Hono<{ Bindings: Env }>();

// GET /api/teams?seasonId=xxx - List all teams for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'Missing required query parameter: seasonId' }, 400);
  }

  const teams = await teamsService.listTeams(c.env.DB, seasonId);
  return c.json(teams);
});

// GET /api/teams/:id - Get a specific team
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const team = await teamsService.getTeamById(c.env.DB, id);

  if (!team) {
    return c.json({ error: 'Team not found' }, 404);
  }

  return c.json(team);
});

// POST /api/teams - Create a new team
router.post('/', async (c) => {
  const input: CreateTeamInput = await c.req.json();

  if (!input.name || !input.seasonId || !input.divisionId) {
    return c.json(
      { error: 'Missing required fields: name, seasonId, divisionId' },
      400
    );
  }

  const team = await teamsService.createTeam(c.env.DB, input);
  return c.json(team, 201);
});

// PUT /api/teams/:id - Update a team
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateTeamInput = await c.req.json();

  const team = await teamsService.updateTeam(c.env.DB, id, input);

  if (!team) {
    return c.json({ error: 'Team not found' }, 404);
  }

  return c.json(team);
});

// DELETE /api/teams/:id - Delete a team
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await teamsService.deleteTeam(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Team not found' }, 404);
  }

  return c.json({ message: 'Team deleted successfully' });
});

export default router;
