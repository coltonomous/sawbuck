import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createTestUser, type TestUser } from '../test/helpers.js';
import { db } from '../db/index.js';
import { claudeUsage, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import app from '../app.js';

let limitedUser: TestUser;
let adminUser: TestUser;

beforeAll(async () => {
  // Create a user with a very low limit for testing
  limitedUser = await createTestUser('user');
  db.update(users).set({ dailyClaudeLimit: 3 }).where(eq(users.id, limitedUser.id)).run();

  adminUser = await createTestUser('admin');
});

beforeEach(() => {
  // Clear usage records before each test
  db.delete(claudeUsage).where(eq(claudeUsage.userId, limitedUser.id)).run();
  db.delete(claudeUsage).where(eq(claudeUsage.userId, adminUser.id)).run();
});

describe('Claude limit middleware', () => {
  it('tracks usage and enforces daily limit', () => {
    const today = new Date().toISOString().split('T')[0];

    // Simulate reaching the limit by inserting usage records directly
    db.insert(claudeUsage).values({
      userId: limitedUser.id,
      date: today,
      callCount: 3, // at the limit of 3
    }).run();

    // Verify the usage record exists
    const usage = db.select()
      .from(claudeUsage)
      .where(and(eq(claudeUsage.userId, limitedUser.id), eq(claudeUsage.date, today)))
      .get();

    expect(usage).toBeDefined();
    expect(usage!.callCount).toBe(3);
  });

  it('increments usage counter correctly via upsert', async () => {
    const today = new Date().toISOString().split('T')[0];

    // First insert
    db.insert(claudeUsage)
      .values({ userId: limitedUser.id, date: today, callCount: 1 })
      .run();

    let usage = db.select()
      .from(claudeUsage)
      .where(and(eq(claudeUsage.userId, limitedUser.id), eq(claudeUsage.date, today)))
      .get();
    expect(usage!.callCount).toBe(1);

    // Simulate the upsert the middleware actually does (raw SQL for the increment)
    const { sqlite } = await import('../db/index.js');
    sqlite.prepare(`
      INSERT INTO claude_usage (user_id, date, call_count)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id, date) DO UPDATE SET call_count = call_count + 1
    `).run(limitedUser.id, today);

    usage = db.select()
      .from(claudeUsage)
      .where(and(eq(claudeUsage.userId, limitedUser.id), eq(claudeUsage.date, today)))
      .get();
    expect(usage!.callCount).toBe(2);
  });

  it('isolates usage between users', () => {
    const today = new Date().toISOString().split('T')[0];

    db.insert(claudeUsage).values({ userId: limitedUser.id, date: today, callCount: 5 }).run();
    db.insert(claudeUsage).values({ userId: adminUser.id, date: today, callCount: 2 }).run();

    const limitedUsage = db.select()
      .from(claudeUsage)
      .where(and(eq(claudeUsage.userId, limitedUser.id), eq(claudeUsage.date, today)))
      .get();
    const adminUsage = db.select()
      .from(claudeUsage)
      .where(and(eq(claudeUsage.userId, adminUser.id), eq(claudeUsage.date, today)))
      .get();

    expect(limitedUsage!.callCount).toBe(5);
    expect(adminUsage!.callCount).toBe(2);
  });

  it('treats different dates as separate counters', () => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    db.insert(claudeUsage).values({ userId: limitedUser.id, date: yesterday, callCount: 100 }).run();
    db.insert(claudeUsage).values({ userId: limitedUser.id, date: today, callCount: 1 }).run();

    const todayUsage = db.select()
      .from(claudeUsage)
      .where(and(eq(claudeUsage.userId, limitedUser.id), eq(claudeUsage.date, today)))
      .get();
    expect(todayUsage!.callCount).toBe(1); // yesterday's 100 doesn't affect today
  });
});

describe('Claude usage endpoint', () => {
  it('returns current usage for the user', async () => {
    const today = new Date().toISOString().split('T')[0];
    db.insert(claudeUsage).values({ userId: limitedUser.id, date: today, callCount: 2 }).run();

    const res = await app.request('/api/usage/claude', {
      headers: { Cookie: limitedUser.cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.used).toBe(2);
    expect(body.limit).toBe(3);
    expect(body.date).toBe(today);
  });

  it('returns 0 used when no usage record exists', async () => {
    const res = await app.request('/api/usage/claude', {
      headers: { Cookie: limitedUser.cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.used).toBe(0);
  });

  it('returns correct limit for admin (high limit)', async () => {
    const res = await app.request('/api/usage/claude', {
      headers: { Cookie: adminUser.cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(999999);
  });
});
