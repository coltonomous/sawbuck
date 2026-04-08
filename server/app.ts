import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { pinoLogger } from 'hono-pino';
import logger from './lib/logger.js';
import { auth } from './auth.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { checkClaudeLimit } from './middleware/claude-limit.js';
import { listingsRouter } from './routes/listings.js';
import { projectsRouter } from './routes/projects.js';
import { scrapersRouter } from './routes/scrapers.js';
import { comparablesRouter } from './routes/comparables.js';
import { statsRouter } from './routes/stats.js';
import { adminRouter } from './routes/admin.js';

const isProd = process.env.NODE_ENV === 'production';

const app = new Hono();

// ── Structured logging ──────────────────────────────────────────────
app.use('*', pinoLogger({ pino: logger }));

// ── Security headers ────────────────────────────────────────────────
app.use('*', secureHeaders({
  referrerPolicy: 'strict-origin-when-cross-origin',
}));

// ── CORS ────────────────────────────────────────────────────────────
// In production the SPA is served same-origin via Caddy, so CORS is
// only needed if a custom origin is explicitly configured.
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || (isProd ? 'self' : 'http://localhost:5173'),
  credentials: true,
}));

// ── Rate limiting ───────────────────────────────────────────────────
// Simple in-memory sliding window per IP. Resets on restart which is
// fine for a single-instance deployment.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_API = 60;       // general API: 60 req/min

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

// ── Global error handler ────────────────────────────────────────────
app.onError((err, c) => {
  const ctxLogger = c.get?.('logger');
  if (ctxLogger) {
    ctxLogger.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled error');
  } else {
    logger.error({ err }, 'Unhandled error');
  }
  return c.json({ error: 'Internal server error' }, 500);
});

// ── Health check (outside auth for Docker HEALTHCHECK) ──────────────
app.get('/health', (c) => c.json({ status: 'ok' }));

// ── Auth routes (handled by better-auth, no requireAuth) ────────────
app.all('/api/auth/*', (c) => auth.handler(c.req.raw));

// ── Require auth for all other API routes ───────────────────────────
app.use('/api/*', requireAuth);

// ── Claude usage limit on AI-calling routes ─────────────────────────
app.use('/api/listings/:id/analyze', checkClaudeLimit);
app.use('/api/projects/:id/refinish', checkClaudeLimit);
app.use('/api/projects/:id/listing-text', checkClaudeLimit);

// ── Admin-only routes ───────────────────────────────────────────────
app.use('/api/admin/*', requireAdmin);

// ── API routes ──────────────────────────────────────────────────────
app.route('/api/listings', listingsRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/scrapers', scrapersRouter);
app.route('/api/comparables', comparablesRouter);
app.route('/api/stats', statsRouter);
app.route('/api/admin', adminRouter);

// ── Claude usage endpoint ───────────────────────────────────────────
app.get('/api/usage/claude', async (c) => {
  const { eq, and } = await import('drizzle-orm');
  const { db } = await import('./db/index.js');
  const { claudeUsage } = await import('./db/schema.js');

  const user = c.get('user');
  const today = new Date().toISOString().split('T')[0];

  const usage = db.select()
    .from(claudeUsage)
    .where(and(eq(claudeUsage.userId, user.id), eq(claudeUsage.date, today)))
    .get();

  return c.json({
    used: usage?.callCount ?? 0,
    limit: user.dailyClaudeLimit ?? 20,
    date: today,
  });
});

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
