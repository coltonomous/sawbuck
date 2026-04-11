import { discover } from '../../integrations/craigslist/ingest.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

// Vary the CL subcategory on each attempt
const CATEGORIES = ['fua', 'fuo', 'fud']; // all furniture, by owner, by dealer

export async function scrapeCategory(state: AgentState): Promise<Partial<AgentState>> {
  const category = CATEGORIES[state.scrapeAttempts % CATEGORIES.length];
  const seenIds = new Set(state.seenExternalIds);

  try {
    const allResults = await discover(category);

    // Filter out listings already triaged in previous attempts this run
    const newResults = allResults.filter((r) => !seenIds.has(r.externalId));
    const newIds = newResults.map((r) => r.externalId);

    logger.info({
      category,
      attempt: state.scrapeAttempts + 1,
      total: allResults.length,
      new: newResults.length,
      skippedAsSeen: allResults.length - newResults.length,
    }, 'Agent scrape node complete');

    return {
      scrapedCandidates: newResults,
      scrapeAttempts: state.scrapeAttempts + 1,
      seenExternalIds: newIds,
    };
  } catch (err) {
    logger.error({ error: String(err), category }, 'Agent scrape node failed');
    return {
      scrapedCandidates: [],
      scrapeAttempts: state.scrapeAttempts + 1,
      errors: [{ node: 'scrape', message: String(err), timestamp: new Date().toISOString() }],
    };
  }
}
