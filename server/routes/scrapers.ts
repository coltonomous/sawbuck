import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/index.js';
import { scrapeRuns, searchConfigs, platformSettings } from '../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { runScraper, runAllActiveScrapers } from '../scrapers/manager.js';

export const scrapersRouter = new Hono();

// POST /run — trigger scrape. Body: { platform?, searchTerm?, location? }
// If no body, runs all active search configs
scrapersRouter.post('/run', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (body.platform && body.searchTerm) {
    // Run a specific scraper
    const result = await runScraper(body.platform, {
      searchTerm: body.searchTerm,
      location: body.location,
      minPrice: body.minPrice,
      maxPrice: body.maxPrice,
    });
    return c.json(result);
  }

  // Run all active configs
  const results = await runAllActiveScrapers();
  return c.json(results);
});

// GET /run/stream — SSE stream of scrape progress
scrapersRouter.get('/run/stream', (c) => {
  return streamSSE(c, async (stream) => {
    await runAllActiveScrapers((progress) => {
      stream.writeSSE({ data: JSON.stringify(progress), event: progress.type });
    });
    // Signal end
    await stream.writeSSE({ data: '{}', event: 'close' });
  });
});

// GET /status — last run times and health
scrapersRouter.get('/status', async (c) => {
  const recentRuns = await db.select()
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(10);

  const configs = await db.select().from(searchConfigs);

  return c.json({ recentRuns, configs });
});

// POST /configs — add search config
scrapersRouter.post('/configs', async (c) => {
  const body = await c.req.json();
  // Platform-agnostic configs: store 'all' so the scraper fans out across enabled platforms
  const result = await db.insert(searchConfigs).values({
    ...body,
    platform: body.platform || 'all',
  } as any).returning();
  return c.json(result[0], 201);
});

// DELETE /configs/all — remove all search configs
scrapersRouter.delete('/configs/all', async (c) => {
  await db.delete(scrapeRuns);
  await db.delete(searchConfigs);
  return c.json({ ok: true });
});

// GET /platforms — list platform enabled/disabled state
scrapersRouter.get('/platforms', async (c) => {
  const platforms = await db.select().from(platformSettings);
  return c.json(platforms);
});

// PATCH /platforms/:platform — toggle platform enabled
scrapersRouter.patch('/platforms/:platform', async (c) => {
  const platform = c.req.param('platform');
  const { enabled } = await c.req.json();
  await db.update(platformSettings)
    .set({ enabled })
    .where(eq(platformSettings.platform, platform));
  return c.json({ ok: true });
});

// DELETE /configs/:id — remove search config
scrapersRouter.delete('/configs/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  await db.delete(scrapeRuns).where(eq(scrapeRuns.searchConfigId, id));
  await db.delete(searchConfigs).where(eq(searchConfigs.id, id));
  return c.json({ ok: true });
});
