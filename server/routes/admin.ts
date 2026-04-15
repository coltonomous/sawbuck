import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, listings, projects, listingClicks, platformSettings, regions } from '../db/schema.js';
import { eq, and, count, inArray } from 'drizzle-orm';
import { getAllSettings, updateSetting, deleteSetting, getAgentConfig } from '../agents/config.js';
import { triggerRun } from '../agents/scheduler.js';
import { getAllJobHealth, isJobOverdue } from '../lib/metrics.js';
import { chunkCount } from '../rag/store.js';
import { updateUserRoleSchema, deleteListingsSchema, updatePlatformSchema, updateRegionSchema, createRegionSchema } from '../lib/validation.js';

// Derived from the DB key names used in agents/config.ts resolve*() calls.
// Adding a new config option there automatically makes it settable here.
const VALID_SETTINGS = new Set([
  'agent.max_triages', 'agent.max_evals',
  'agent.triage_threshold', 'agent.deal_score_threshold',
  'agent.min_delay_ms', 'agent.max_delay_ms', 'agent.daily_request_cap',
  'agent.run_interval_ms', 'agent.triage_model',
  'agent.eval_model', 'agent.fal_model', 'agent.concept_size',
  'agent.image_retention_days',
  'rag.max_chunks_per_type',
]);

const settingsUpdateSchema = z.record(z.string(), z.string()).refine(
  (obj) => Object.keys(obj).every((key) => VALID_SETTINGS.has(key)),
  { message: 'Unknown setting key' },
);

const adminRouter = new Hono()
  .get('/users', async (c) => {
  const allUsers = await db.select().from(users);

  const projectCounts = await db.select({
    userId: projects.userId,
    total: count(),
  }).from(projects).groupBy(projects.userId);

  const soldCounts = await db.select({
    userId: projects.userId,
    total: count(),
  }).from(projects).where(eq(projects.status, 'sold')).groupBy(projects.userId);

  const clickCounts = await db.select({
    userId: listingClicks.userId,
    total: count(),
  }).from(listingClicks).groupBy(listingClicks.userId);

  const projectMap = new Map(projectCounts.map(p => [p.userId, p.total]));
  const soldMap = new Map(soldCounts.map(s => [s.userId, s.total]));
  const clickMap = new Map(clickCounts.map(c => [c.userId, c.total]));

  return c.json(allUsers.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    role: u.role,
    projectCount: projectMap.get(u.id) ?? 0,
    soldCount: soldMap.get(u.id) ?? 0,
    clickCount: clickMap.get(u.id) ?? 0,
    createdAt: u.createdAt,
  })));
})
.patch('/users/:id/role', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateUserRoleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);
  const { role } = parsed.data;

  const currentUser = c.get('user');
  if (id === currentUser.id && role !== 'admin') {
    return c.json({ error: 'Cannot demote yourself' }, 400);
  }

  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
  return c.json({ ok: true });
})
.delete('/users/:id', async (c) => {
  const id = c.req.param('id');

  const currentUser = c.get('user');
  if (id === currentUser.id) {
    return c.json({ error: 'Cannot delete yourself' }, 400);
  }

  const user = await db.select().from(users).where(eq(users.id, id)).then(r => r[0]);
  if (!user) return c.json({ error: 'User not found' }, 404);

  // FK cascades handle all dependent records:
  // users → sessions, accounts, listings, projects, backgroundJobs, comparables, refinishingPlans, userDismissals, listingClicks
  // listings → listingImages, refinishingPlans, comparables, conceptRenders, projects
  // projects → projectPhotos, and sets null on refinishingPlans.projectId, materials.projectId
  // refinishingPlans → materials
  await db.delete(users).where(eq(users.id, id));

  return c.json({ ok: true });
})
// GET /settings — get all agent config (current resolved values + DB overrides)
.get('/settings', async (c) => {
  const dbSettings = await getAllSettings();
  const resolved = getAgentConfig();
  return c.json({ resolved, overrides: dbSettings });
})
// PATCH /settings — update agent config values
.patch('/settings', async (c) => {
  const body = await c.req.json();
  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === '') {
      await deleteSetting(key);
    } else {
      await updateSetting(key, value);
    }
  }

  return c.json({ ok: true, resolved: getAgentConfig() });
})
// POST /agent/run — manually trigger an agent pipeline run
.post('/agent/run', async (c) => {
  const started = triggerRun();
  if (!started) {
    return c.json({ error: 'A run is already in progress' }, 409);
  }
  return c.json({ ok: true, message: 'Agent pipeline run started' });
})
// DELETE /listings — bulk delete agent-discovered listings by IDs
.delete('/listings', async (c) => {
  const body = await c.req.json();
  const parsed = deleteListingsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);
  const { ids } = parsed.data;

  // Only allow deleting agent-discovered listings (userId IS NULL)
  const agentListings = await db.select({ id: listings.id })
    .from(listings)
    .where(inArray(listings.id, ids));

  const validIds = agentListings.map(l => l.id);
  if (validIds.length === 0) {
    return c.json({ error: 'No matching agent listings found' }, 404);
  }

  // FK cascades handle listingImages and conceptRenders
  await db.delete(listings).where(inArray(listings.id, validIds));

  return c.json({ ok: true, deleted: validIds.length });
})
// ── Platforms ───────────────────────────────────────────────────────

.get('/platforms', async (c) => {
  const all = await db.select().from(platformSettings);
  return c.json(all);
})
.patch('/platforms/:platform', async (c) => {
  const platform = c.req.param('platform') as 'craigslist' | 'offerup' | 'ebay' | 'sawbuck';
  const body = await c.req.json();
  const parsed = updatePlatformSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);
  await db.update(platformSettings).set({ enabled: parsed.data.enabled }).where(eq(platformSettings.platform, platform));
  return c.json({ ok: true });
})
// ── Regions ─────────────────────────────────────────────────────────

.get('/regions', async (c) => {
  const all = await db.select().from(regions);
  return c.json(all);
})
.post('/regions', async (c) => {
  const raw = await c.req.json();
  const parsed = createRegionSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);
  const [created] = await db.insert(regions).values({
    name: parsed.data.name,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    radiusMiles: parsed.data.radiusMiles ?? 30,
    clSubdomain: parsed.data.clSubdomain ?? null,
  }).returning();
  return c.json(created, 201);
})
.patch('/regions/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const body = await c.req.json();
  const parsed = updateRegionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  await db.update(regions).set(parsed.data).where(eq(regions.id, id));
  return c.json({ ok: true });
})
.delete('/regions/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  await db.delete(regions).where(eq(regions.id, id));
  return c.json({ ok: true });
})

// ── Metrics / observability ────────────────────────────────────────
.get('/metrics', async (c) => {
  const RECONCILE_OVERDUE_MS = 12 * 60 * 60 * 1000; // 12 hours
  const IMAGE_CLEANUP_OVERDUE_MS = 48 * 60 * 60 * 1000; // 48 hours
  const [projectChunks, productChunks, guideChunks] = await Promise.all([
    chunkCount('project'),
    chunkCount('product'),
    chunkCount('guide'),
  ]);

  const config = getAgentConfig();
  const jobHealth = getAllJobHealth();
  const overdueJobs: string[] = [];

  if (isJobOverdue('reconcile', RECONCILE_OVERDUE_MS)) overdueJobs.push('reconcile');
  if (isJobOverdue('image-cleanup', IMAGE_CLEANUP_OVERDUE_MS)) overdueJobs.push('image-cleanup');

  return c.json({
    rag: {
      chunks: { project: projectChunks, product: productChunks, guide: guideChunks },
      total: projectChunks + productChunks + guideChunks,
      maxPerType: config.ragMaxChunksPerType,
    },
    jobs: jobHealth,
    overdueJobs,
  });
});

export { adminRouter };
