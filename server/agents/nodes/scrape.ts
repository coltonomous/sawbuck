import { craigslistIntegration } from '../../integrations/craigslist/index.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

export async function scrapeCategory(state: AgentState): Promise<Partial<AgentState>> {
  try {
    const results = await craigslistIntegration.ingest();

    logger.info({ candidates: results.length }, 'Agent scrape node complete');

    return {
      scrapedCandidates: results,
      scrapeAttempts: state.scrapeAttempts + 1,
    };
  } catch (err) {
    logger.error({ error: String(err) }, 'Agent scrape node failed');
    return {
      scrapedCandidates: [],
      scrapeAttempts: state.scrapeAttempts + 1,
      errors: [{ node: 'scrape', message: String(err), timestamp: new Date().toISOString() }],
    };
  }
}
