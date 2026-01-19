import { Hono } from 'hono';
import { cors } from 'hono/cors';
import seasonsRouter from './routes/seasons.js';
import divisionsRouter from './routes/divisions.js';
import divisionConfigsRouter from './routes/division-configs.js';
import fieldsRouter from './routes/fields.js';
import seasonFieldsRouter from './routes/season-fields.js';
import teamsRouter from './routes/teams.js';
import battingCagesRouter from './routes/batting-cages.js';
import seasonCagesRouter from './routes/season-cages.js';
import fieldAvailabilitiesRouter from './routes/field-availabilities.js';
import cageAvailabilitiesRouter from './routes/cage-availabilities.js';
import fieldDateOverridesRouter from './routes/field-date-overrides.js';
import cageDateOverridesRouter from './routes/cage-date-overrides.js';
import scheduledEventsRouter from './routes/scheduled-events.js';
import scheduleGeneratorRouter from './routes/schedule-generator.js';
import savedSchedulesRouter from './routes/saved-schedules.js';
import savedConfigsRouter from './routes/saved-configs.js';
import availableSlotsRouter from './routes/available-slots.js';

export type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('/*', cors({
  origin: (origin) => {
    // Allow localhost for development
    if (origin?.startsWith('http://localhost:')) {
      return origin;
    }
    // Allow Cloudflare Pages domains (production and preview deployments)
    if (origin?.endsWith('.pages.dev') || origin?.endsWith('.ll-scheduler.pages.dev')) {
      return origin;
    }
    // Allow custom domain
    if (origin === 'https://cpll.baldino.me') {
      return origin;
    }
    // Return null to reject other origins
    return null;
  },
  credentials: true,
}));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.route('/api/seasons', seasonsRouter);
app.route('/api/divisions', divisionsRouter);
app.route('/api/division-configs', divisionConfigsRouter);
app.route('/api/fields', fieldsRouter);
app.route('/api/season-fields', seasonFieldsRouter);
app.route('/api/teams', teamsRouter);
app.route('/api/batting-cages', battingCagesRouter);
app.route('/api/season-cages', seasonCagesRouter);
app.route('/api/field-availabilities', fieldAvailabilitiesRouter);
app.route('/api/cage-availabilities', cageAvailabilitiesRouter);
app.route('/api/field-date-overrides', fieldDateOverridesRouter);
app.route('/api/cage-date-overrides', cageDateOverridesRouter);
app.route('/api/scheduled-events', scheduledEventsRouter);
app.route('/api/schedule-generator', scheduleGeneratorRouter);
app.route('/api/saved-schedules', savedSchedulesRouter);
app.route('/api/saved-configs', savedConfigsRouter);
app.route('/api/available-slots', availableSlotsRouter);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

export default app;
