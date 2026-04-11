import { discover } from '../../integrations/craigslist/ingest.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

// Vary the CL subcategory on each attempt
const CATEGORIES = ['fua', 'fuo', 'fud']; // all furniture, by owner, by dealer

export async function scrapeCategory(state: AgentState): Promise<Partial<AgentState>> {
  const category = CATEGORIES[state.scrapeAttempts % CATEGORIES.length];

  try {
    const results = await discover(category);

    logger.info({ candidates: results.length, category, attempt: state.scrapeAttempts + 1 }, 'Agent scrape node complete');

    return {
      scrapedCandidates: results,
      scrapeAttempts: state.scrapeAttempts + 1,
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
