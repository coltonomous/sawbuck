import { discover } from '../../integrations/craigslist/ingest.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

// CL RSS returns ~100 items per page. Paginate deeper on retries.
const PAGE_SIZE = 100;

export async function scrapeCategory(state: AgentState): Promise<Partial<AgentState>> {
  const offset = state.scrapeAttempts * PAGE_SIZE;
  const seenIds = new Set(state.seenExternalIds);

  try {
    const allResults = await discover(offset);

    // Filter out listings already triaged in previous attempts this run
    const newResults = allResults.filter((r) => !seenIds.has(r.externalId));
    const newIds = newResults.map((r) => r.externalId);

    logger.info({
      offset,
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
    logger.error({ error: String(err), offset }, 'Agent scrape node failed');
    return {
      scrapedCandidates: [],
      scrapeAttempts: state.scrapeAttempts + 1,
      errors: [{ node: 'scrape', message: String(err), timestamp: new Date().toISOString() }],
    };
  }
}
