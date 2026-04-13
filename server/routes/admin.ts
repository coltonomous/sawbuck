import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, listings } from '../db/schema.js';
import { eq, and, count, inArray } from 'drizzle-orm';
import { getAllSettings, updateSetting, deleteSetting, getAgentConfig } from '../agents/config.js';
import { triggerRun } from '../agents/scheduler.js';

// Derived from the DB key names used in agents/config.ts resolve*() calls.
// Adding a new config option there automatically makes it settable here.
const VALID_SETTINGS = new Set([
  'agent.max_triages', 'agent.max_evals', 'agent.max_renders',
  'agent.concepts_per_listing', 'agent.triage_threshold', 'agent.deal_score_threshold',
  'agent.min_delay_ms', 'agent.max_delay_ms', 'agent.daily_request_cap',
  'agent.run_interval_ms', 'agent.target_city', 'agent.triage_model',
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

  const listingCounts = await db.select({
    userId: listings.userId,
    count: count(),
  }).from(listings).groupBy(listings.userId);

  const listingMap = new Map(listingCounts.map(l => [l.userId, l.count]));

  return c.json(allUsers.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    role: u.role,
    listingCount: listingMap.get(u.id) ?? 0,
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
  // users → sessions, accounts, listings, projects, searchConfigs, scrapeRuns, backgroundJobs, comparables, refinishingPlans
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

export { adminRouter };
