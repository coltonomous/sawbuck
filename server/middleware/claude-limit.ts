import type { Context, Next } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { claudeUsage } from '../db/schema.js';
import type { AuthUser } from '../auth.js';

export async function checkClaudeLimit(c: Context, next: Next) {
  const user: AuthUser = c.get('user');

  // Admin users have unlimited access
  if (user.role === 'admin') {
    return next();
  }

  const today = new Date().toISOString().split('T')[0];

  const usage = db.select()
    .from(claudeUsage)
    .where(and(eq(claudeUsage.userId, user.id), eq(claudeUsage.date, today)))
    .get();

  const count = usage?.callCount ?? 0;
  const limit = user.dailyClaudeLimit ?? 20;

  if (count >= limit) {
    return c.json({
      error: `Daily analysis limit reached (${count}/${limit}). Resets at midnight UTC.`,
    }, 429);
  }

  // Increment usage (upsert)
  db.insert(claudeUsage)
    .values({ userId: user.id, date: today, callCount: 1 })
    .onConflictDoUpdate({
      target: [claudeUsage.userId, claudeUsage.date],
      set: { callCount: sql`${claudeUsage.callCount} + 1` },
    })
    .run();

  await next();
}
