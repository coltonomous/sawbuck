import { serve } from '@hono/node-server';
import app from './app.js';
import { bootstrapKnowledgeBase } from './rag/bootstrap.js';
import { cleanupOrphanedImages } from './images/cleanup.js';
import { startScheduler, stopScheduler } from './agents/scheduler.js';
import { promoteAdmin } from './lib/seed-admin.js';
import { seedPlatformDefaults } from './integrations/registry.js';
import { db, pool } from './db/index.js';
import { sessions } from './db/schema.js';
import { lt } from 'drizzle-orm';
import logger from './lib/logger.js';

const port = parseInt(process.env.PORT || '3001');
logger.info(`Server running on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

// Promote ADMIN_EMAIL user to admin role (idempotent)
promoteAdmin();

// Seed platform settings and initial region if tables are empty
seedPlatformDefaults();

// Background: load embedding model + seed knowledge base if empty
bootstrapKnowledgeBase();

// Daily image cleanup — run once on startup (catches up after restarts),
// then every 24 hours. No separate cron service needed.
const IMAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function runImageCleanup() {
  cleanupOrphanedImages().catch((err) => {
    logger.error({ err }, 'Scheduled image cleanup failed');
  });
}

// Delay initial run by 30s to let the server finish starting up
setTimeout(runImageCleanup, 30_000);
const cleanupTimer = setInterval(runImageCleanup, IMAGE_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

// Purge expired sessions daily (same cadence as image cleanup)
function purgeExpiredSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).catch((err) => {
    logger.error({ err }, 'Session cleanup failed');
  });
}
setTimeout(purgeExpiredSessions, 60_000);
const sessionCleanupTimer = setInterval(purgeExpiredSessions, IMAGE_CLEANUP_INTERVAL_MS);
sessionCleanupTimer.unref();

// Agent pipeline scheduler — runs automatically if AWS Bedrock is configured
if (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION) {
  setTimeout(() => startScheduler(), 10_000);
} else {
  logger.info('AWS_REGION not set — agent scheduler disabled');
}

// Reconcile stale listings — runs independently from the pipeline every 6 hours
// so it doesn't block the scrape → triage → evaluate flow.
const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
async function runReconcile() {
  try {
    const { reconcileListings } = await import('./agents/nodes/reconcile.js');
    const result = await reconcileListings({
      runId: 'reconcile-' + Date.now(),
      startedAt: new Date().toISOString(),
      scrapedCandidates: [],
      triagedCandidates: [],
      passedTriage: [],
      evaluatedCandidates: [],
      qualifiedListings: [],
      listingsWithOptions: [],
      conceptRenders: [],
      removedIds: [],
      reconciledCount: 0,
      triageCount: {},
      evalCount: {},
      qualifiedCount: 0,
      conceptsRendered: 0,
      scrapeAttempts: {},
      seenExternalIds: [],
      scrapeTask: null,
      errors: [],
      summary: null,
    });
    logger.info({ reconciled: result.reconciledCount }, 'Standalone reconcile complete');
  } catch (err) {
    logger.error({ err }, 'Standalone reconcile failed');
  }
}
setTimeout(runReconcile, 2 * 60_000); // first run 2 min after startup
const reconcileTimer = setInterval(runReconcile, RECONCILE_INTERVAL_MS);
reconcileTimer.unref();

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');
  clearInterval(cleanupTimer);
  clearInterval(sessionCleanupTimer);
  clearInterval(reconcileTimer);
  stopScheduler();

  // Wait for in-flight requests to finish, then drain the connection pool
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
