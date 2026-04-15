import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from './logger.js';
import { env } from './env.js';

/**
 * Promote the user matching ADMIN_EMAIL to admin role.
 * Runs on every startup — idempotent. If the user hasn't signed up yet,
 * this is a no-op; they'll be promoted on the next restart after signup.
 */
export async function promoteAdmin(): Promise<void> {
  const email = env.adminEmail;
  if (!email) return;

  try {
    const user = await db.select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .then(r => r[0]);

    if (!user) {
      logger.info({ email }, 'Admin user not found yet — will promote on next restart after signup');
      return;
    }

    if (user.role === 'admin') return;

    await db.update(users)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(eq(users.id, user.id));

    logger.info({ email }, 'Promoted user to admin');
  } catch (err) {
    logger.warn({ email, err: (err as Error).message }, 'Failed to promote admin (non-fatal)');
  }
}
