import { discover } from '../../integrations/craigslist/ingest.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

export async function scrapeCategory(state: AgentState): Promise<Partial<AgentState>> {
  const page = state.scrapeAttempts; // 0-indexed page number
  const seenIds = new Set(state.seenExternalIds);

  try {
    const allResults = await discover(page);

    // Filter out listings already triaged in previous attempts this run
    const newResults = allResults.filter((r) => !seenIds.has(r.externalId));
    const newIds = newResults.map((r) => r.externalId);

    logger.info({
      page,
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
    logger.error({ error: String(err), page }, 'Agent scrape node failed');
    return {
      scrapedCandidates: [],
      scrapeAttempts: state.scrapeAttempts + 1,
      errors: [{ node: 'scrape', message: String(err), timestamp: new Date().toISOString() }],
    };
  }
}
