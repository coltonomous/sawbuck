import { serve } from '@hono/node-server';
import app from './app.js';
import { closeBrowser } from './scrapers/browser-pool.js';

const port = parseInt(process.env.PORT || '3001');
console.log(`Server running on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

// Graceful shutdown
async function shutdown() {
  console.log('[server] Shutting down...');
  await closeBrowser();
  server.close(() => {
    console.log('[server] Closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
