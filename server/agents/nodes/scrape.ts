import { Send, Command } from '@langchain/langgraph';
import { getEnabledPlatforms, getEnabledRegions } from '../../integrations/registry.js';
import { reportProgress } from '../progress.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

/**
 * Dispatch node: fans out scrape tasks to scrapeOne via LangGraph Command + Send.
 * One Send per (platform, region) combination at the current page offset.
 * Results merge in the scrapeOne node via the scrapedCandidates append reducer.
 */
const MAX_SCRAPE_ATTEMPTS = 3;

export async function dispatchScrapes(state: AgentState): Promise<Command> {
  const platforms = await getEnabledPlatforms();
  const regions = await getEnabledRegions();
  const attempts = state.scrapeAttempts;

  if (platforms.length === 0) {
    logger.warn('No enabled platforms, nothing to scrape');
    return new Command({ goto: 'mergeScrapes' });
  }
  if (regions.length === 0) {
    logger.warn('No enabled regions, nothing to scrape');
    return new Command({ goto: 'mergeScrapes' });
  }

  // Only dispatch platforms that still have retry budget
  const eligible = platforms.filter((p) => (attempts[p.platform] ?? 0) < MAX_SCRAPE_ATTEMPTS);
  if (eligible.length === 0) {
    logger.info('All platforms exhausted scrape budget');
    return new Command({ goto: 'mergeScrapes' });
  }

  logger.info({
    platforms: eligible.map((p) => `${p.platform}(${attempts[p.platform] ?? 0}/${MAX_SCRAPE_ATTEMPTS})`),
    regions: regions.map((r) => r.name),
  }, 'Dispatching scrape tasks');

  const sends: Send[] = [];
  for (const platform of eligible) {
    const page = attempts[platform.platform] ?? 0;
    for (const region of regions) {
      sends.push(new Send('scrapeOne', {
        scrapeTask: { platform: platform.platform, region, page },
      }));
    }
  }

  return new Command({ goto: sends });
}

/**
 * Post-scrape node: increments scrapeAttempts counter after all scrapeOne tasks merge.
 */
export async function afterScrapesMerge(state: AgentState): Promise<Partial<AgentState>> {
  // Increment attempt count for each platform that produced candidates this round
  const platformsSeen = new Set(state.scrapedCandidates.map((c) => c.platform));
  const updatedAttempts = { ...state.scrapeAttempts };
  for (const platform of platformsSeen) {
    updatedAttempts[platform] = (updatedAttempts[platform] ?? 0) + 1;
  }
  // Also increment platforms that were dispatched but returned nothing
  const enabledPlatforms = await getEnabledPlatforms();
  for (const p of enabledPlatforms) {
    if (!platformsSeen.has(p.platform) && (updatedAttempts[p.platform] ?? 0) < MAX_SCRAPE_ATTEMPTS) {
      updatedAttempts[p.platform] = (updatedAttempts[p.platform] ?? 0) + 1;
    }
  }

  logger.info({
    scraped: state.scrapedCandidates.length,
    attempts: updatedAttempts,
  }, 'All scrape tasks merged');

  reportProgress(state.runId, { scraped: state.scrapedCandidates.length });

  return {
    scrapeAttempts: updatedAttempts,
  };
}
