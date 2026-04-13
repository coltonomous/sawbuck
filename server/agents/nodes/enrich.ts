import { enrich } from '../../integrations/craigslist/index.js';
import type { AgentState, TriagedCandidate } from '../state.js';
import logger from '../../lib/logger.js';

/** Fetch detail pages only for candidates that passed triage. */
export async function enrichPassed(state: AgentState): Promise<Partial<AgentState>> {
  const passed = state.passedTriage;

  if (passed.length === 0) {
    return { passedTriage: [], removedIds: [] };
  }

  logger.info({ count: passed.length }, 'Enrich node: fetching detail pages for triage-passed candidates');

  try {
    const { enriched, removedIds } = await enrich(passed);

    // Map enriched ScrapedCandidates back to TriagedCandidates by
    // re-attaching the triageResult from the original passed list
    const triageMap = new Map(passed.map((p) => [p.externalId, p.triageResult]));
    const enrichedWithTriage: TriagedCandidate[] = enriched.map((e) => ({
      ...e,
      triageResult: triageMap.get(e.externalId)!,
    }));

    return { passedTriage: enrichedWithTriage, removedIds };
  } catch (err) {
    logger.error({ error: String(err) }, 'Enrich node failed');
    return {
      passedTriage: passed, // keep RSS data on failure
      removedIds: [],
      errors: [{ node: 'enrich', message: String(err), timestamp: new Date().toISOString() }],
    };
  }
}
