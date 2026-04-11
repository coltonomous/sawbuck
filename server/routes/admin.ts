import { Hono } from 'hono';
import { db, pool } from '../db/index.js';
import { users, listings } from '../db/schema.js';
import { eq, count } from 'drizzle-orm';
import { getAllSettings, updateSetting, getAgentConfig } from '../agents/config.js';

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM materials WHERE refinishing_plan_id IN (SELECT id FROM refinishing_plans WHERE listing_id IN (SELECT id FROM listings WHERE user_id = $1))', [id]);
    await client.query('DELETE FROM listing_images WHERE listing_id IN (SELECT id FROM listings WHERE user_id = $1)', [id]);
    await client.query('DELETE FROM project_photos WHERE project_id IN (SELECT id FROM projects WHERE user_id = $1)', [id]);
    await client.query('DELETE FROM refinishing_plans WHERE listing_id IN (SELECT id FROM listings WHERE user_id = $1)', [id]);
    await client.query('DELETE FROM comparables WHERE listing_id IN (SELECT id FROM listings WHERE user_id = $1)', [id]);
    await client.query('DELETE FROM projects WHERE user_id = $1', [id]);
    await client.query('DELETE FROM listings WHERE user_id = $1', [id]);
    await client.query('DELETE FROM background_jobs WHERE user_id = $1', [id]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await client.query('DELETE FROM accounts WHERE user_id = $1', [id]);
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK');
    return c.json({ error: `Failed to delete user: ${err.message}` }, 500);
  } finally {
    client.release();
  }

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
  const updates = await c.req.json<Record<string, string>>();

  for (const [key, value] of Object.entries(updates)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    await updateSetting(key, String(value));
  }

  return c.json({ ok: true, resolved: getAgentConfig() });
});

export { adminRouter };
