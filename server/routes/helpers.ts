import type { Context } from 'hono';
import { db } from '../db/index.js';
import { listings, projects } from '../db/schema.js';
import { eq, and, or, isNull } from 'drizzle-orm';

/** Parse and validate a positive integer route parameter. Returns NaN if invalid. */
export function parseId(c: Context, name = 'id'): number {
  const val = parseInt(c.req.param(name));
  return Number.isFinite(val) && val > 0 ? val : NaN;
}

/** Escape SQL LIKE wildcard characters so user input is treated literally. */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, (ch) => '\\' + ch);
}

/**
 * Fetch a listing the user owns, or an agent-discovered listing (userId IS NULL),
 * or a community sawbuck listing. Returns null if not found or not accessible.
 */
export async function getVisibleListing(listingId: number, userId: string) {
  return db.select().from(listings).where(
    and(eq(listings.id, listingId), or(eq(listings.userId, userId), eq(listings.platform, 'sawbuck'), isNull(listings.userId))),
  ).then(r => r[0] ?? null);
}

/**
 * Fetch a listing the user owns or that is agent-discovered (userId IS NULL).
 * Used for update/action operations (not for read-only viewing).
 */
export async function getEditableListing(listingId: number, userId: string) {
  return db.select().from(listings).where(
    and(eq(listings.id, listingId), or(eq(listings.userId, userId), isNull(listings.userId))),
  ).then(r => r[0] ?? null);
}

/** Fetch a listing owned by the user only. */
export async function getOwnedListing(listingId: number, userId: string) {
  return db.select().from(listings).where(
    and(eq(listings.id, listingId), eq(listings.userId, userId)),
  ).then(r => r[0] ?? null);
}

/** Fetch a project owned by the user. */
export async function getOwnedProject(projectId: number, userId: string) {
  return db.select().from(projects).where(
    and(eq(projects.id, projectId), eq(projects.userId, userId)),
  ).then(r => r[0] ?? null);
}
