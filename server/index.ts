import { serve } from '@hono/node-server';
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
app.use('*', cors({ origin: 'http://localhost:5173' }));

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
  // Fallback to index.html for SPA routing
  app.get('/*', serveStatic({ root: './client/dist/', path: 'index.html' }));
}

const port = parseInt(process.env.PORT || '3001');
console.log(`Server running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });

export default app;
