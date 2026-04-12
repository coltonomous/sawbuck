import { serve } from '@hono/node-server';
import app from './app.js';
import { bootstrapKnowledgeBase } from './rag/bootstrap.js';
import { cleanupOrphanedImages } from './images/cleanup.js';
import { startScheduler, stopScheduler } from './agents/scheduler.js';
import { promoteAdmin } from './lib/seed-admin.js';
import logger from './lib/logger.js';

const port = parseInt(process.env.PORT || '3001');
logger.info(`Server running on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

// Promote ADMIN_EMAIL user to admin role (idempotent)
promoteAdmin();

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

// Agent pipeline scheduler — runs automatically if AWS Bedrock is configured
if (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION) {
  setTimeout(() => startScheduler(), 10_000);
} else {
  logger.info('AWS_REGION not set — agent scheduler disabled');
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');
  clearInterval(cleanupTimer);
  stopScheduler();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
