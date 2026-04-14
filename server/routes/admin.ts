import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, listings, projects, listingClicks, platformSettings, regions } from '../db/schema.js';
import { eq, and, count, inArray } from 'drizzle-orm';
import { getAllSettings, updateSetting, deleteSetting, getAgentConfig } from '../agents/config.js';
import { triggerRun } from '../agents/scheduler.js';

// Derived from the DB key names used in agents/config.ts resolve*() calls.
// Adding a new config option there automatically makes it settable here.
const VALID_SETTINGS = new Set([
  'agent.max_triages', 'agent.max_evals',
  'agent.triage_threshold', 'agent.deal_score_threshold',
  'agent.min_delay_ms', 'agent.max_delay_ms', 'agent.daily_request_cap',
  'agent.run_interval_ms', 'agent.triage_model',
  'agent.eval_model', 'agent.fal_model', 'agent.concept_size',
  'agent.image_retention_days',
]);

const settingsUpdateSchema = z.record(z.string(), z.string()).refine(
  (obj) => Object.keys(obj).every((key) => VALID_SETTINGS.has(key)),
  { message: 'Unknown setting key' },
);

const adminRouter = new Hono();

adminRouter.get('/users', async (c) => {
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
});

adminRouter.patch('/users/:id/role', async (c) => {
  const id = c.req.param('id');
  const { role } = await c.req.json<{ role: 'user' | 'admin' }>();

  if (!['user', 'admin'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  const currentUser = c.get('user');
  if (id === currentUser.id && role !== 'admin') {
    return c.json({ error: 'Cannot demote yourself' }, 400);
  }

  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
  return c.json({ ok: true });
});

adminRouter.delete('/users/:id', async (c) => {
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
});

// GET /settings — get all agent config (current resolved values + DB overrides)
adminRouter.get('/settings', async (c) => {
  const dbSettings = await getAllSettings();
  const resolved = getAgentConfig();
  return c.json({ resolved, overrides: dbSettings });
});

// PATCH /settings — update agent config values
adminRouter.patch('/settings', async (c) => {
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
});

// POST /agent/run — manually trigger an agent pipeline run
adminRouter.post('/agent/run', async (c) => {
  const started = triggerRun();
  if (!started) {
    return c.json({ error: 'A run is already in progress' }, 409);
  }
  return c.json({ ok: true, message: 'Agent pipeline run started' });
});

// DELETE /listings — bulk delete agent-discovered listings by IDs
adminRouter.delete('/listings', async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }

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
});

// ── Platforms ───────────────────────────────────────────────────────

adminRouter.get('/platforms', async (c) => {
  const all = await db.select().from(platformSettings);
  return c.json(all);
});

adminRouter.patch('/platforms/:platform', async (c) => {
  const platform = c.req.param('platform') as 'craigslist' | 'offerup' | 'ebay' | 'sawbuck';
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  if (typeof enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }
  await db.update(platformSettings).set({ enabled }).where(eq(platformSettings.platform, platform));
  return c.json({ ok: true });
});

// ── Regions ─────────────────────────────────────────────────────────

const regionCreateSchema = z.object({
  name: z.string().min(1).max(50),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMiles: z.number().int().min(1).max(200).default(30),
  clSubdomain: z.string().max(50).nullable().optional(),
});

adminRouter.get('/regions', async (c) => {
  const all = await db.select().from(regions);
  return c.json(all);
});

adminRouter.post('/regions', async (c) => {
  const raw = await c.req.json();
  const parsed = regionCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const [created] = await db.insert(regions).values({
    name: parsed.data.name,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    radiusMiles: parsed.data.radiusMiles,
    clSubdomain: parsed.data.clSubdomain ?? null,
  }).returning();
  return c.json(created, 201);
});

adminRouter.patch('/regions/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const body = await c.req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
  if (typeof body.name === 'string') updates.name = body.name;
  if (typeof body.latitude === 'number') updates.latitude = body.latitude;
  if (typeof body.longitude === 'number') updates.longitude = body.longitude;
  if (typeof body.radiusMiles === 'number') updates.radiusMiles = body.radiusMiles;
  if (body.clSubdomain !== undefined) updates.clSubdomain = body.clSubdomain;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  await db.update(regions).set(updates).where(eq(regions.id, id));
  return c.json({ ok: true });
});

adminRouter.delete('/regions/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  await db.delete(regions).where(eq(regions.id, id));
  return c.json({ ok: true });
});

export { adminRouter };
