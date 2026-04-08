import { serve } from '@hono/node-server';
import app from './app.js';
import { closeBrowser } from './scrapers/browser-pool.js';
import { bootstrapKnowledgeBase } from './rag/bootstrap.js';
import { cleanupOrphanedImages } from './images/cleanup.js';
import logger from './lib/logger.js';

const port = parseInt(process.env.PORT || '3001');
logger.info(`Server running on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

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

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');
  clearInterval(cleanupTimer);
  await closeBrowser();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
