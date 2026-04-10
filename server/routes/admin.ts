import { Hono } from 'hono';
import { db, sqlite } from '../db/index.js';
import { users, listings } from '../db/schema.js';
import { eq, count } from 'drizzle-orm';

const adminRouter = new Hono();

// GET / — list all users with stats
adminRouter.get('/users', async (c) => {
  const allUsers = db.select().from(users).all();

  const listingCounts = db.select({
    userId: listings.userId,
    count: count(),
  }).from(listings).groupBy(listings.userId).all();

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

// PATCH /users/:id/role — update user role
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

  db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)).run();

  return c.json({ ok: true });
});

// DELETE /users/:id — delete user and all their data
adminRouter.delete('/users/:id', async (c) => {
  const id = c.req.param('id');

  const currentUser = c.get('user');
  if (id === currentUser.id) {
    return c.json({ error: 'Cannot delete yourself' }, 400);
  }

  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) return c.json({ error: 'User not found' }, 404);

  try {
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM materials WHERE refinishing_plan_id IN (SELECT id FROM refinishing_plans WHERE listing_id IN (SELECT id FROM listings WHERE user_id = ?))').run(id);
      sqlite.prepare('DELETE FROM listing_images WHERE listing_id IN (SELECT id FROM listings WHERE user_id = ?)').run(id);
      sqlite.prepare('DELETE FROM project_photos WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)').run(id);
      sqlite.prepare('DELETE FROM refinishing_plans WHERE listing_id IN (SELECT id FROM listings WHERE user_id = ?)').run(id);
      sqlite.prepare('DELETE FROM comparables WHERE listing_id IN (SELECT id FROM listings WHERE user_id = ?)').run(id);
      sqlite.prepare('DELETE FROM projects WHERE user_id = ?').run(id);
      sqlite.prepare('DELETE FROM listings WHERE user_id = ?').run(id);
      sqlite.prepare('DELETE FROM background_jobs WHERE user_id = ?').run(id);
      sqlite.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      sqlite.prepare('DELETE FROM accounts WHERE user_id = ?').run(id);
      sqlite.prepare('DELETE FROM users WHERE id = ?').run(id);
    })();
  } catch (err: any) {
    return c.json({ error: `Failed to delete user: ${err.message}` }, 500);
  }

  return c.json({ ok: true });
});

export { adminRouter };
