import { Hono } from 'hono';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema.js';
import { desc } from 'drizzle-orm';

export const scrapersRouter = new Hono()
  // GET /status — agent run history for monitoring
  .get('/status', async (c) => {
    const recentRuns = await db.select()
      .from(agentRuns)
      .orderBy(desc(agentRuns.startedAt))
      .limit(20);

    return c.json({ recentRuns });
  });
