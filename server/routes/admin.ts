import { Hono } from 'hono';
import { db } from '../db/index.js';
import { users, sessions, listings, projects, claudeUsage } from '../db/schema.js';
import { eq, and, count, sql } from 'drizzle-orm';

const adminRouter = new Hono();

// GET / — list all users with usage stats
adminRouter.get('/users', async (c) => {
  const allUsers = db.select().from(users).all();

  const today = new Date().toISOString().split('T')[0];
  const usageToday = db.select({
    userId: claudeUsage.userId,
    callCount: claudeUsage.callCount,
  }).from(claudeUsage).where(eq(claudeUsage.date, today)).all();

  const usageMap = new Map(usageToday.map(u => [u.userId, u.callCount]));

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
    dailyClaudeLimit: u.dailyClaudeLimit,
    usageToday: usageMap.get(u.id) ?? 0,
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

  // Prevent demoting yourself
  const currentUser = c.get('user');
  if (id === currentUser.id && role !== 'admin') {
    return c.json({ error: 'Cannot demote yourself' }, 400);
  }

  db.update(users).set({
    role,
    dailyClaudeLimit: role === 'admin' ? 999999 : 20,
    updatedAt: new Date(),
  }).where(eq(users.id, id)).run();

  return c.json({ ok: true });
});

// PATCH /users/:id/limit — update daily Claude limit
adminRouter.patch('/users/:id/limit', async (c) => {
  const id = c.req.param('id');
  const { limit } = await c.req.json<{ limit: number }>();

  if (typeof limit !== 'number' || limit < 0) {
    return c.json({ error: 'Invalid limit' }, 400);
  }

  db.update(users).set({
    dailyClaudeLimit: limit,
    updatedAt: new Date(),
  }).where(eq(users.id, id)).run();

  return c.json({ ok: true });
});

// DELETE /users/:id — delete user and all their data
adminRouter.delete('/users/:id', async (c) => {
  const id = c.req.param('id');

  // Prevent deleting yourself
  const currentUser = c.get('user');
  if (id === currentUser.id) {
    return c.json({ error: 'Cannot delete yourself' }, 400);
  }

  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) return c.json({ error: 'User not found' }, 404);

  // Cascading deletes handle sessions, accounts, etc.
  db.delete(users).where(eq(users.id, id)).run();

  return c.json({ ok: true });
});

export { adminRouter };
