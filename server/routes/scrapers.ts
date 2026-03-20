import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/index.js';
import { scrapeRuns, searchConfigs, platformSettings, backgroundJobs } from '../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { runScraper, runAllActiveScrapers } from '../scrapers/manager.js';
import type { Platform } from '../../shared/constants.js';
import { runScraperSchema, addSearchConfigSchema, togglePlatformSchema } from '../lib/validation.js';
import crypto from 'crypto';

export const scrapersRouter = new Hono();

// POST /run — trigger scrape in background. Returns job ID immediately.
// Body: { platform?, searchTerm?, location? }
// If no body, runs all active search configs
scrapersRouter.post('/run', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = runScraperSchema.safeParse(body);

  const jobId = crypto.randomUUID();
  await db.insert(backgroundJobs).values({ id: jobId, type: 'scrape' });

  if (parsed.success && parsed.data.platform && parsed.data.searchTerm) {
    runScraper(parsed.data.platform, {
      searchTerm: parsed.data.searchTerm,
      location: parsed.data.location,
      minPrice: parsed.data.minPrice,
      maxPrice: parsed.data.maxPrice,
    }).then(async (result) => {
      await db.update(backgroundJobs).set({
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: JSON.stringify(result),
      }).where(eq(backgroundJobs.id, jobId));
    }).catch(async (err) => {
      await db.update(backgroundJobs).set({
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: err.message,
      }).where(eq(backgroundJobs.id, jobId));
    });
  } else {
    runAllActiveScrapers().then(async (results) => {
      await db.update(backgroundJobs).set({
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: JSON.stringify(results),
      }).where(eq(backgroundJobs.id, jobId));
    }).catch(async (err) => {
      await db.update(backgroundJobs).set({
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: err.message,
      }).where(eq(backgroundJobs.id, jobId));
    });
  }

  return c.json({ jobId }, 202);
});

// GET /jobs/:id — poll job status (persisted in DB, survives restarts)
scrapersRouter.get('/jobs/:id', async (c) => {
  const job = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, c.req.param('id'))).get();
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json({
    ...job,
    result: job.result ? JSON.parse(job.result) : undefined,
  });
});

// GET /run/stream — SSE stream of scrape progress
scrapersRouter.get('/run/stream', (c) => {
  return streamSSE(c, async (stream) => {
    // Send keepalive comments every 15s to prevent Cloudflare/proxy idle timeouts
    const keepalive = setInterval(() => {
      stream.writeSSE({ data: '', event: 'keepalive' }).catch(() => {});
    }, 15_000);

    try {
      await runAllActiveScrapers((progress) => {
        stream.writeSSE({ data: JSON.stringify(progress), event: progress.type });
      });
      await stream.writeSSE({ data: '{}', event: 'close' });
    } finally {
      clearInterval(keepalive);
    }
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
    platform: parsed.data.platform as 'craigslist' | 'offerup' | 'mercari' | 'ebay' | 'facebook',
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
// Auto-inserts any missing platforms so new ones appear in Settings immediately
scrapersRouter.get('/platforms', async (c) => {
  const { PLATFORMS } = await import('../../shared/constants.js');
  const existing = await db.select().from(platformSettings);
  const existingSet = new Set(existing.map((p) => p.platform));
  for (const p of PLATFORMS) {
    if (!existingSet.has(p)) {
      await db.insert(platformSettings).values({ platform: p as Platform, enabled: true }).onConflictDoNothing();
    }
  }
  const platforms = existingSet.size === PLATFORMS.length
    ? existing
    : await db.select().from(platformSettings);
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
    .where(eq(platformSettings.platform, platform as 'craigslist' | 'offerup' | 'mercari' | 'ebay' | 'facebook'));
  return c.json({ ok: true });
});

// DELETE /configs/:id — remove search config
scrapersRouter.delete('/configs/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  await db.delete(scrapeRuns).where(eq(scrapeRuns.searchConfigId, id));
  await db.delete(searchConfigs).where(eq(searchConfigs.id, id));
  return c.json({ ok: true });
});
