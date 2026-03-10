import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/index.js';
import { scrapeRuns, searchConfigs, platformSettings } from '../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { runScraper, runAllActiveScrapers, type ScrapeResult } from '../scrapers/manager.js';
import { runScraperSchema, addSearchConfigSchema, togglePlatformSchema } from '../lib/validation.js';
import crypto from 'crypto';

export const scrapersRouter = new Hono();

// In-memory job tracker for background scrape operations
interface ScrapeJob {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  result?: ScrapeResult | ScrapeResult[];
  error?: string;
}
const scrapeJobs = new Map<string, ScrapeJob>();

// POST /run — trigger scrape in background. Returns job ID immediately.
// Body: { platform?, searchTerm?, location? }
// If no body, runs all active search configs
scrapersRouter.post('/run', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = runScraperSchema.safeParse(body);

  const jobId = crypto.randomUUID();
  scrapeJobs.set(jobId, { status: 'running', startedAt: new Date().toISOString() });

  if (parsed.success && parsed.data.platform && parsed.data.searchTerm) {
    // Fire and forget — single platform scrape
    runScraper(parsed.data.platform, {
      searchTerm: parsed.data.searchTerm,
      location: parsed.data.location,
      minPrice: parsed.data.minPrice,
      maxPrice: parsed.data.maxPrice,
    }).then((result) => {
      scrapeJobs.set(jobId, { status: 'completed', startedAt: scrapeJobs.get(jobId)!.startedAt, result });
    }).catch((err) => {
      scrapeJobs.set(jobId, { status: 'failed', startedAt: scrapeJobs.get(jobId)!.startedAt, error: err.message });
    });
  } else {
    // Fire and forget — all active configs
    runAllActiveScrapers().then((results) => {
      scrapeJobs.set(jobId, { status: 'completed', startedAt: scrapeJobs.get(jobId)!.startedAt, result: results });
    }).catch((err) => {
      scrapeJobs.set(jobId, { status: 'failed', startedAt: scrapeJobs.get(jobId)!.startedAt, error: err.message });
    });
  }

  return c.json({ jobId }, 202);
});

// GET /jobs/:id — poll job status
scrapersRouter.get('/jobs/:id', (c) => {
  const job = scrapeJobs.get(c.req.param('id'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json(job);
});

// GET /run/stream — SSE stream of scrape progress
scrapersRouter.get('/run/stream', (c) => {
  return streamSSE(c, async (stream) => {
    await runAllActiveScrapers((progress) => {
      stream.writeSSE({ data: JSON.stringify(progress), event: progress.type });
    });
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
  const raw = await c.req.json();
  const parsed = addSearchConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const [result] = await db.insert(searchConfigs).values({
    platform: parsed.data.platform as 'craigslist' | 'offerup' | 'mercari' | 'ebay',
    searchTerm: parsed.data.searchTerm,
    category: parsed.data.category ?? null,
    location: parsed.data.location ?? null,
    minPrice: parsed.data.minPrice ?? null,
    maxPrice: parsed.data.maxPrice ?? null,
  }).returning();
  return c.json(result, 201);
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
  const raw = await c.req.json();
  const parsed = togglePlatformSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  await db.update(platformSettings)
    .set({ enabled: parsed.data.enabled })
    .where(eq(platformSettings.platform, platform as 'craigslist' | 'offerup' | 'mercari' | 'ebay'));
  return c.json({ ok: true });
});

// DELETE /configs/:id — remove search config
scrapersRouter.delete('/configs/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  await db.delete(scrapeRuns).where(eq(scrapeRuns.searchConfigId, id));
  await db.delete(searchConfigs).where(eq(searchConfigs.id, id));
  return c.json({ ok: true });
});
