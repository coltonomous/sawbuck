import { serve } from '@hono/node-server';
import app from './app.js';
import { bootstrapKnowledgeBase } from './rag/bootstrap.js';
import { startScheduler, stopScheduler } from './agents/scheduler.js';
import { seedPlatformDefaults } from './integrations/registry.js';
import { db, pool } from './db/index.js';
import { sessions } from './db/schema.js';
import { lt } from 'drizzle-orm';
import logger from './lib/logger.js';
import { recordJobRun, isJobOverdue } from './lib/metrics.js';

const port = parseInt(process.env.PORT || '3001');
logger.info(`Server running on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

if (process.env.ADMIN_EMAIL) {
  logger.warn(
    'ADMIN_EMAIL is set but auto-promotion is disabled — promote admins manually via `npx tsx scripts/promote-admin.ts <email>`',
  );
}

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

// Daily listing cleanup — delete agent-discovered listings older than the configured cutoff
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_OVERDUE_MS = 36 * 60 * 60 * 1000;

async function runListingCleanup() {
  const start = Date.now();
  try {
    const { cleanupOldListings } = await import('./lib/cleanup.js');
    const { deleted } = await cleanupOldListings();
    recordJobRun('listing_cleanup', 'success', Date.now() - start, { deleted });
  } catch (err) {
    recordJobRun('listing_cleanup', 'failure', Date.now() - start);
    logger.error({ err }, 'Listing cleanup failed');
  }
}
setTimeout(runListingCleanup, 5 * 60_000); // first run 5 min after startup
const cleanupTimer = setInterval(runListingCleanup, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

// Periodic overdue check — warn if cleanup hasn't run in 36 hours
const overdueCheckTimer = setInterval(() => {
  if (isJobOverdue('listing_cleanup', CLEANUP_OVERDUE_MS)) {
    logger.warn('Listing cleanup job is overdue — last successful run was more than 36 hours ago');
  }
}, 60 * 60 * 1000); // check every hour
overdueCheckTimer.unref();

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');
  clearInterval(sessionCleanupTimer);
  clearInterval(cleanupTimer);
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

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
});

export default app;
