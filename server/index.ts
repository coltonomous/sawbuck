import { serve } from '@hono/node-server';
import app from './app.js';
import { bootstrapKnowledgeBase } from './rag/bootstrap.js';
import { startScheduler, stopScheduler } from './agents/scheduler.js';
import { promoteAdmin } from './lib/seed-admin.js';
import { seedPlatformDefaults } from './integrations/registry.js';
import { db, pool } from './db/index.js';
import { sessions } from './db/schema.js';
import { lt } from 'drizzle-orm';
import logger from './lib/logger.js';
import { recordJobRun, isJobOverdue } from './lib/metrics.js';

const port = parseInt(process.env.PORT || '3001');
logger.info(`Server running on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

// Promote ADMIN_EMAIL user to admin role (idempotent)
promoteAdmin();

// Seed platform settings and initial region if tables are empty
seedPlatformDefaults();

// Background: load embedding model + seed knowledge base if empty
bootstrapKnowledgeBase();

// Purge expired sessions daily
function purgeExpiredSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).catch((err) => {
    logger.error({ err }, 'Session cleanup failed');
  });
}
const SESSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
setTimeout(purgeExpiredSessions, 60_000);
const sessionCleanupTimer = setInterval(purgeExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);
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
const RECONCILE_OVERDUE_MS = 12 * 60 * 60 * 1000;

async function runReconcile() {
  const start = Date.now();
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

    const durationMs = Date.now() - start;
    const hasErrors = result.errors && result.errors.length > 0;
    recordJobRun('reconcile', 'success', durationMs, {
      reconciled: result.reconciledCount ?? 0,
      errors: result.errors?.length ?? 0,
    });
    logger.info(
      { reconciled: result.reconciledCount, durationMs, errors: result.errors?.length ?? 0 },
      'Standalone reconcile complete',
    );

    if (hasErrors) {
      logger.warn({ errors: result.errors }, 'Reconcile completed with errors');
    }
  } catch (err) {
    recordJobRun('reconcile', 'failure', Date.now() - start);
    logger.error({ err }, 'Standalone reconcile failed');
  }
}
setTimeout(runReconcile, 2 * 60_000); // first run 2 min after startup
const reconcileTimer = setInterval(runReconcile, RECONCILE_INTERVAL_MS);
reconcileTimer.unref();

// Periodic overdue check — warn if reconcile hasn't run in 12+ hours
const overdueCheckTimer = setInterval(() => {
  if (isJobOverdue('reconcile', RECONCILE_OVERDUE_MS)) {
    logger.warn('Reconcile job is overdue — last successful run was more than 12 hours ago');
  }
}, 60 * 60 * 1000); // check every hour
overdueCheckTimer.unref();

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');
  clearInterval(sessionCleanupTimer);
  clearInterval(reconcileTimer);
  clearInterval(overdueCheckTimer);
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
