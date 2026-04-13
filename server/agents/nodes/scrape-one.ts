import { getIntegration } from '../../integrations/registry.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

/**
 * Execute a single scrape task for one (platform, region, page) combination.
 * Dispatched by the scrape node via LangGraph Send.
 */
export async function scrapeOne(state: AgentState): Promise<Partial<AgentState>> {
  const task = state.scrapeTask;
  if (!task) {
    logger.error('scrapeOne called without a scrapeTask in state');
    return { scrapedCandidates: [] };
  }

  const { platform, region, page } = task;
  const seenIds = new Set(state.seenExternalIds);

  const integration = getIntegration(platform);
  if (!integration) {
    logger.error({ platform }, 'scrapeOne: no integration registered for platform');
    return {
      scrapedCandidates: [],
      errors: [{ node: 'scrapeOne', message: `No integration for platform: ${platform}`, timestamp: new Date().toISOString() }],
    };
  }

  try {
    const allResults = await integration.discover(region, page);
    const newResults = allResults.filter((r) => !seenIds.has(r.externalId));
    const newIds = newResults.map((r) => r.externalId);

    logger.info({
      platform,
      region: region.name,
      page,
      total: allResults.length,
      new: newResults.length,
    }, 'scrapeOne complete');

    return {
      scrapedCandidates: newResults,
      seenExternalIds: newIds,
    };
  } catch (err) {
    logger.error({ platform, region: region.name, error: String(err) }, 'scrapeOne failed');
    return {
      scrapedCandidates: [],
      errors: [{ node: 'scrapeOne', message: `${platform}/${region.name}: ${String(err)}`, timestamp: new Date().toISOString() }],
    };
  }
}
