/**
 * Web server entry point — serves the HTTP API and static assets.
 *
 * Background tasks (agent pipeline, image cleanup, reconciliation)
 * run in a separate worker process (server/worker.ts).
 *
 * For single-process deployments (e.g. development), pass --with-worker
 * or set SAWBUCK_RUN_WORKER=1 to run both in one process.
 */

import { serve } from '@hono/node-server';
import app from './app.js';
import { env } from './lib/env.js';
import { promoteAdmin } from './lib/seed-admin.js';
import { seedPlatformDefaults } from './integrations/registry.js';
import { db, pool } from './db/index.js';
import { sessions } from './db/schema.js';
import { lt } from 'drizzle-orm';
import logger from './lib/logger.js';
import { initPostGIS } from './db/postgis.js';

const port = env.port;
logger.info(`Server running on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

// ── One-time startup tasks ─────────────────────────────────────────
promoteAdmin();
seedPlatformDefaults();
initPostGIS();

// ── Session cleanup (daily) ────────────────────────────────────────
const SESSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function purgeExpiredSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).catch((err) => {
    logger.error({ err }, 'Session cleanup failed');
  });
}
setTimeout(purgeExpiredSessions, 60_000);
const sessionCleanupTimer = setInterval(purgeExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);
sessionCleanupTimer.unref();

// ── Optional: run worker in-process for development ────────────────
const runWorker = process.argv.includes('--with-worker')
  || process.env.SAWBUCK_RUN_WORKER === '1';

if (runWorker) {
  logger.info('Running worker in-process (--with-worker)');
  import('./worker.js');
}

// ── Graceful shutdown ──────────────────────────────────────────────
async function shutdown() {
  logger.info('Shutting down...');
  clearInterval(sessionCleanupTimer);

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing close');
      resolve();
    }, 30_000);

    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });

  try {
    await pool.end();
    logger.info('Connection pool drained');
  } catch (err) {
    logger.error({ err }, 'Failed to drain connection pool');
  }

  logger.info('Server closed');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
