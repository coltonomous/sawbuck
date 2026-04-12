import { db } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { eq, and, inArray, isNull, notInArray } from 'drizzle-orm';
import { agentConfig } from '../config.js';
import { AntiBlockingController } from '../anti-blocking.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

/**
 * Reconcile node: mark removed CL listings in the DB.
 *
 * Two sources of removal signals:
 * 1. Enrichment 404s — candidates whose detail pages returned 404 during enrich
 * 2. RSS misses — existing DB listings not seen in recent RSS feeds, verified by
 *    probing their detail pages (only agent-discovered, non-acquired listings)
 */
export async function reconcileListings(state: AgentState): Promise<Partial<AgentState>> {
  let reconciledCount = 0;
  const errors: AgentState['errors'] = [];

  // ── Part 1: Mark enrichment 404s ─────────────────────────────────
  // These are freshly triaged candidates whose detail pages were gone.
  // They haven't been inserted to the DB yet (that happens in evaluate),
  // so we just log them — they'll never be inserted.
  if (state.removedIds.length > 0) {
    logger.info({ count: state.removedIds.length }, 'Reconcile: candidates removed before evaluation');
    reconciledCount += state.removedIds.length;
  }

  // ── Part 2: Probe existing DB listings missing from RSS ──────────
  // Compare the IDs we saw in RSS this run against recent agent listings
  // in the DB. Listings not in RSS might have been taken down.
  try {
    const recentRssIds = state.seenExternalIds;
    if (recentRssIds.length === 0) {
      return { reconciledCount };
    }

    // Find agent-discovered CL listings in 'new' or 'analyzed' status
    // that weren't seen in this run's RSS feeds
    const candidates = await db.select({
      id: listings.id,
      externalId: listings.externalId,
      url: listings.url,
    })
      .from(listings)
      .where(and(
        eq(listings.platform, 'craigslist'),
        isNull(listings.userId),
        inArray(listings.status, ['new', 'analyzed']),
        notInArray(listings.externalId, recentRssIds),
      ))
      .limit(20); // cap to avoid hammering CL

    if (candidates.length === 0) {
      return { reconciledCount };
    }

    logger.info({ count: candidates.length }, 'Reconcile: probing DB listings missing from RSS');

    const antiBlocking = new AntiBlockingController({
      minDelayBetweenRequestsMs: agentConfig.minDelayBetweenRequestsMs,
      maxDelayBetweenRequestsMs: agentConfig.maxDelayBetweenRequestsMs,
      dailyRequestCap: agentConfig.dailyRequestCap,
    });

    const removedListingIds: number[] = [];

    for (const listing of candidates) {
      try {
        await antiBlocking.beforeRequest();
        const res = await fetch(listing.url, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        antiBlocking.onSuccess();

        if (res.status === 404) {
          removedListingIds.push(listing.id);
        } else if (res.ok) {
          // Listing still exists — check for CL deletion page via GET
          // Only do this for a subset to limit requests
          const bodyRes = await fetch(listing.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html',
            },
          });
          const html = await bodyRes.text();
          if (html.includes('This posting has been deleted') || html.includes('This posting has expired')) {
            removedListingIds.push(listing.id);
          }
        }
      } catch (err) {
        antiBlocking.onError(err);
        // Network errors are not removal signals — skip
      }
    }

    if (removedListingIds.length > 0) {
      await db.update(listings)
        .set({ status: 'removed' })
        .where(inArray(listings.id, removedListingIds));

      reconciledCount += removedListingIds.length;
      logger.info({ count: removedListingIds.length }, 'Reconcile: marked DB listings as removed');
    }
  } catch (err) {
    logger.error({ error: String(err) }, 'Reconcile: RSS miss check failed');
    errors.push({ node: 'reconcile', message: String(err), timestamp: new Date().toISOString() });
  }

  return { reconciledCount, errors };
}
