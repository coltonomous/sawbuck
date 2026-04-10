import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const preferencesRouter = new Hono();

const updatePreferencesSchema = z.object({
  preferredLatitude: z.number().min(-90).max(90).nullable().optional(),
  preferredLongitude: z.number().min(-180).max(180).nullable().optional(),
  preferredRadiusMiles: z.number().int().min(1).max(500).optional(),
  maxBudget: z.number().min(0).nullable().optional(),
  shopSpace: z.enum(['small_workshop', 'one_car_garage', 'two_car_garage', 'full_shop']).nullable().optional(),
  experienceLevel: z.enum(['beginner', 'intermediate', 'advanced']).nullable().optional(),
  stylePreferences: z.array(z.string()).nullable().optional(),
}).refine(
  (data) => {
    const hasLat = data.preferredLatitude !== undefined && data.preferredLatitude !== null;
    const hasLng = data.preferredLongitude !== undefined && data.preferredLongitude !== null;
    return hasLat === hasLng; // both or neither
  },
  { message: 'Latitude and longitude must be provided together', path: ['preferredLatitude'] },
);

// GET /api/user/preferences
preferencesRouter.get('/', async (c) => {
  const user = c.get('user');
  const row = await db.select({
    preferredLatitude: users.preferredLatitude,
    preferredLongitude: users.preferredLongitude,
    preferredRadiusMiles: users.preferredRadiusMiles,
    maxBudget: users.maxBudget,
    shopSpace: users.shopSpace,
    experienceLevel: users.experienceLevel,
    stylePreferences: users.stylePreferences,
  }).from(users).where(eq(users.id, user.id)).get();

  if (!row) return c.json({ error: 'User not found' }, 404);

  return c.json({
    ...row,
    stylePreferences: row.stylePreferences ? JSON.parse(row.stylePreferences) : null,
  });
});

// PATCH /api/user/preferences
preferencesRouter.patch('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = updatePreferencesSchema.safeParse(body);

  if (!parsed.success) {
    const fieldErrors = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return c.json({ error: 'Validation failed', fields: fieldErrors }, 400);
  }

  const updates: Record<string, unknown> = {};
  const data = parsed.data;

  if (data.preferredLatitude !== undefined) updates.preferredLatitude = data.preferredLatitude;
  if (data.preferredLongitude !== undefined) updates.preferredLongitude = data.preferredLongitude;
  if (data.preferredRadiusMiles !== undefined) updates.preferredRadiusMiles = data.preferredRadiusMiles;
  if (data.maxBudget !== undefined) updates.maxBudget = data.maxBudget;
  if (data.shopSpace !== undefined) updates.shopSpace = data.shopSpace;
  if (data.experienceLevel !== undefined) updates.experienceLevel = data.experienceLevel;
  if (data.stylePreferences !== undefined) {
    updates.stylePreferences = data.stylePreferences ? JSON.stringify(data.stylePreferences) : null;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));

  return c.json({ success: true });
});
