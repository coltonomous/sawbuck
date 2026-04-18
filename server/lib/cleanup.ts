/**
 * Daily cleanup: delete agent-discovered listings older than the configured
 * cutoff. User-posted listings (userId IS NOT NULL) are never touched.
 */

import { db } from '../db/index.js';
import { listings } from '../db/schema.js';
import { and, isNull, lt, sql } from 'drizzle-orm';
import { agentConfig } from '../agents/config.js';
import logger from './logger.js';

export async function cleanupOldListings(): Promise<{ deleted: number }> {
  const maxAgeDays = agentConfig.listingMaxAgeDays;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const result = await db.delete(listings).where(
    and(
      isNull(listings.userId),
      lt(sql`COALESCE(${listings.postedAt}, ${listings.scrapedAt})`, cutoff),
    ),
  ).returning({ id: listings.id });

  const deleted = result.length;
  if (deleted > 0) {
    logger.info({ deleted, cutoffDays: maxAgeDays }, 'Listing cleanup: deleted old agent-discovered listings');
  } else {
    logger.info({ cutoffDays: maxAgeDays }, 'Listing cleanup: no listings older than cutoff');
  }

  return { deleted };
}
