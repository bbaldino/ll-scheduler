import { Hono } from 'hono';
import { cors } from 'hono/cors';
import seasonsRouter from './routes/seasons.js';
import seasonPhasesRouter from './routes/season-phases.js';
import divisionsRouter from './routes/divisions.js';
import divisionConfigsRouter from './routes/division-configs.js';
import fieldsRouter from './routes/fields.js';
import teamsRouter from './routes/teams.js';
import battingCagesRouter from './routes/batting-cages.js';
import fieldAvailabilitiesRouter from './routes/field-availabilities.js';
import cageAvailabilitiesRouter from './routes/cage-availabilities.js';
import fieldDateOverridesRouter from './routes/field-date-overrides.js';
import cageDateOverridesRouter from './routes/cage-date-overrides.js';
import scheduledEventsRouter from './routes/scheduled-events.js';
import scheduleGeneratorRouter from './routes/schedule-generator.js';

export type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'], // Add production URL later
  credentials: true,
}));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.route('/api/seasons', seasonsRouter);
app.route('/api/season-phases', seasonPhasesRouter);
app.route('/api/divisions', divisionsRouter);
app.route('/api/division-configs', divisionConfigsRouter);
app.route('/api/fields', fieldsRouter);
app.route('/api/teams', teamsRouter);
app.route('/api/batting-cages', battingCagesRouter);
app.route('/api/field-availabilities', fieldAvailabilitiesRouter);
app.route('/api/cage-availabilities', cageAvailabilitiesRouter);
app.route('/api/field-date-overrides', fieldDateOverridesRouter);
app.route('/api/cage-date-overrides', cageDateOverridesRouter);
app.route('/api/scheduled-events', scheduledEventsRouter);
app.route('/api/schedule-generator', scheduleGeneratorRouter);

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
