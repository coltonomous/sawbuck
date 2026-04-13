import { Send } from '@langchain/langgraph';
import { getEnabledPlatforms, getEnabledRegions } from '../../integrations/registry.js';
import { reportProgress } from '../progress.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

/**
 * Dispatch node: fans out scrape tasks to scrapeOne via LangGraph Send.
 * One Send per (platform, region) combination at the current page offset.
 * Results merge in the scrapeOne node via the scrapedCandidates append reducer.
 */
export async function dispatchScrapes(state: AgentState): Promise<Send[]> {
  const platforms = await getEnabledPlatforms();
  const regions = await getEnabledRegions();
  const page = state.scrapeAttempts;

  if (platforms.length === 0) {
    logger.warn('No enabled platforms, nothing to scrape');
    return [];
  }
  if (regions.length === 0) {
    logger.warn('No enabled regions, nothing to scrape');
    return [];
  }

  logger.info({
    platforms: platforms.map((p) => p.platform),
    regions: regions.map((r) => r.name),
    page,
  }, 'Dispatching scrape tasks');

  const sends: Send[] = [];
  for (const platform of platforms) {
    for (const region of regions) {
      sends.push(new Send('scrapeOne', {
        scrapeTask: { platform: platform.platform, region, page },
      }));
    }
  }

  return sends;
}

/**
 * Post-scrape node: increments scrapeAttempts counter after all scrapeOne tasks merge.
 * Also clears scrapedCandidates for the next iteration if needed.
 */
export async function afterScrapesMerge(state: AgentState): Promise<Partial<AgentState>> {
  logger.info({
    scraped: state.scrapedCandidates.length,
    attempt: state.scrapeAttempts + 1,
  }, 'All scrape tasks merged');

  reportProgress(state.runId, { scraped: state.scrapedCandidates.length });

  return {
    scrapeAttempts: state.scrapeAttempts + 1,
  };
}
