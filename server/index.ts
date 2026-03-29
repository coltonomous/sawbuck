import { serve } from '@hono/node-server';
import app from './app.js';
import { closeBrowser } from './scrapers/browser-pool.js';
import logger from './lib/logger.js';

const port = parseInt(process.env.PORT || '3001');
logger.info(`Server running on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');
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
