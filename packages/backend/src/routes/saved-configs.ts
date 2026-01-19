import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { CreateSavedConfigInput, UpdateSavedConfigInput } from '@ll-scheduler/shared';
import {
  listSavedConfigs,
  getSavedConfigById,
  saveConfig,
  updateSavedConfig,
  restoreConfig,
  deleteSavedConfig,
} from '../services/saved-configs.js';

const router = new Hono<{ Bindings: Env }>();

// GET /api/saved-configs - List saved configs for a season
router.get('/', async (c) => {
  const seasonId = c.req.query('seasonId');

  if (!seasonId) {
    return c.json({ error: 'seasonId is required' }, 400);
  }

  const configs = await listSavedConfigs(c.env.DB, seasonId);
  return c.json(configs);
});

// GET /api/saved-configs/:id - Get a specific saved config
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const config = await getSavedConfigById(c.env.DB, id);

  if (!config) {
    return c.json({ error: 'Saved config not found' }, 404);
  }

  return c.json(config);
});

// POST /api/saved-configs - Save the current config
router.post('/', async (c) => {
  const input: CreateSavedConfigInput = await c.req.json();

  if (!input.seasonId) {
    return c.json({ error: 'seasonId is required' }, 400);
  }
  if (!input.name || input.name.trim() === '') {
    return c.json({ error: 'name is required' }, 400);
  }

  const config = await saveConfig(c.env.DB, {
    seasonId: input.seasonId,
    name: input.name.trim(),
    description: input.description?.trim(),
  });

  return c.json(config, 201);
});

// POST /api/saved-configs/:id/restore - Restore a saved config
router.post('/:id/restore', async (c) => {
  const id = c.req.param('id');

  try {
    const result = await restoreConfig(c.env.DB, id);
    return c.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Saved config not found') {
      return c.json({ error: 'Saved config not found' }, 404);
    }
    throw error;
  }
});

// PUT /api/saved-configs/:id - Update a saved config (overwrites with current data)
router.put('/:id', async (c) => {
  const id = c.req.param('id');
  const input: UpdateSavedConfigInput = await c.req.json();

  if (!input.name || input.name.trim() === '') {
    return c.json({ error: 'name is required' }, 400);
  }

  const config = await updateSavedConfig(c.env.DB, id, {
    name: input.name.trim(),
    description: input.description?.trim(),
  });

  if (!config) {
    return c.json({ error: 'Saved config not found' }, 404);
  }

  return c.json(config);
});

// DELETE /api/saved-configs/:id - Delete a saved config
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteSavedConfig(c.env.DB, id);

  if (!deleted) {
    return c.json({ error: 'Saved config not found' }, 404);
  }

  return c.json({ success: true });
});

export default router;
