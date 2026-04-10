import { enrich } from '../../integrations/craigslist/index.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

/** Fetch detail pages only for candidates that passed triage. */
export async function enrichPassed(state: AgentState): Promise<Partial<AgentState>> {
  const passed = state.passedTriage;

  if (passed.length === 0) {
    return { passedTriage: [] };
  }

  logger.info({ count: passed.length }, 'Enrich node: fetching detail pages for triage-passed candidates');

  try {
    const enriched = await enrich(passed);
    return { passedTriage: enriched };
  } catch (err) {
    logger.error({ error: String(err) }, 'Enrich node failed');
    return {
      passedTriage: passed, // keep RSS data on failure
      errors: [{ node: 'enrich', message: String(err), timestamp: new Date().toISOString() }],
    };
  }
}
