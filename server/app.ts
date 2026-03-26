import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { pinoLogger } from 'hono-pino';
import pino from 'pino';
import { listingsRouter } from './routes/listings.js';
import { projectsRouter } from './routes/projects.js';
import { scrapersRouter } from './routes/scrapers.js';
import { comparablesRouter } from './routes/comparables.js';
import { statsRouter } from './routes/stats.js';

const isProd = process.env.NODE_ENV === 'production';

const app = new Hono();

// ── Structured logging ──────────────────────────────────────────────
app.use('*', pinoLogger({
  pino: pino({
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    ...(!isProd && { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  }),
}));

// ── Security headers ────────────────────────────────────────────────
app.use('*', secureHeaders({
  referrerPolicy: 'strict-origin-when-cross-origin',
}));

// ── CORS ────────────────────────────────────────────────────────────
// In production the SPA is served same-origin via Caddy, so CORS is
// only needed if a custom origin is explicitly configured.
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || (isProd ? 'self' : 'http://localhost:5173'),
}));

// ── Rate limiting ───────────────────────────────────────────────────
// Simple in-memory sliding window per IP. Resets on restart which is
// fine for a single-instance deployment.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_API = 60;       // general API: 60 req/min
const RATE_LIMIT_CLAUDE = 10;    // Claude-calling routes: 10 req/min

const hits = new Map<string, { count: number; resetAt: number }>();

// Purge expired entries every 5 minutes to prevent unbounded Map growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now > entry.resetAt) hits.delete(key);
  }
}, 5 * 60_000).unref();

function rateLimit(limit: number) {
  return async (c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown';
    const key = `${ip}:${limit}`;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    } else {
      entry.count++;
      if (entry.count > limit) {
        c.res.headers.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
        return c.json({ error: 'Too many requests' }, 429);
      }
    }
    await next();
  };
}

// Apply general rate limit to all API routes
app.use('/api/*', rateLimit(RATE_LIMIT_API));

// Tighter limit on routes that call Claude (cost money)
app.use('/api/listings/:id/analyze', rateLimit(RATE_LIMIT_CLAUDE));
app.use('/api/projects/:id/refinish', rateLimit(RATE_LIMIT_CLAUDE));
app.use('/api/projects/:id/listing-text', rateLimit(RATE_LIMIT_CLAUDE));

// ── Global error handler ────────────────────────────────────────────
app.onError((err, c) => {
  const logger = c.get?.('logger');
  if (logger) {
    logger.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled error');
  } else {
    console.error('Unhandled error:', err);
  }
  return c.json({ error: 'Internal server error' }, 500);
});

// ── Health check (outside auth for Docker HEALTHCHECK) ──────────────
app.get('/health', (c) => c.json({ status: 'ok' }));

// ── API routes ──────────────────────────────────────────────────────
app.route('/api/listings', listingsRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/scrapers', scrapersRouter);
app.route('/api/comparables', comparablesRouter);
app.route('/api/stats', statsRouter);

// ── Serve listing images with cache headers ─────────────────────────
app.use('/images/*', async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.res.headers.set('Cache-Control', 'public, max-age=86400, immutable');
  }
});
app.use('/images/*', serveStatic({ root: './data/' }));

// ── SPA serving in production ───────────────────────────────────────
if (isProd) {
  app.use('/*', serveStatic({ root: './client/dist/' }));
  app.get('/*', serveStatic({ root: './client/dist/', path: 'index.html' }));
}

export default app;
