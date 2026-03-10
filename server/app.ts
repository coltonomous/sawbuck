import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { listingsRouter } from './routes/listings.js';
import { projectsRouter } from './routes/projects.js';
import { scrapersRouter } from './routes/scrapers.js';
import { comparablesRouter } from './routes/comparables.js';
import { statsRouter } from './routes/stats.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
}));

// API key auth — skip for static assets, only guard /api routes
app.use('/api/*', async (c, next) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next();
  const provided = c.req.header('Authorization')?.replace('Bearer ', '');
  if (provided !== apiKey) return c.json({ error: 'Unauthorized' }, 401);
  return next();
});

// Health check (outside auth so it works for Docker HEALTHCHECK)
app.get('/health', (c) => c.json({ status: 'ok' }));

// API routes
app.route('/api/listings', listingsRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/scrapers', scrapersRouter);
app.route('/api/comparables', comparablesRouter);
app.route('/api/stats', statsRouter);

// Serve listing images
app.use('/images/*', serveStatic({ root: './data/' }));

// In production, serve the built React SPA
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './client/dist/' }));
  app.get('/*', serveStatic({ root: './client/dist/', path: 'index.html' }));
}

export default app;
