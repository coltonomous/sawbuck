import type { Context, Next } from 'hono';
import { auth, type AuthUser } from '../auth.js';

// Extend Hono's context variables to include user
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    logger: any;
  }
}

export async function requireAuth(c: Context, next: Next) {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', session.user as AuthUser);
  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (session.user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  c.set('user', session.user as AuthUser);
  await next();
}
