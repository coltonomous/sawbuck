import { getIntegration } from '../../integrations/registry.js';
import type { AgentState, TriagedCandidate } from '../state.js';
import type { ScrapedCandidate, EnrichResult } from '../../integrations/common/types.js';
import logger from '../../lib/logger.js';

/** Fetch detail pages only for candidates that passed triage. */
export async function enrichPassed(state: AgentState): Promise<Partial<AgentState>> {
  const passed = state.passedTriage;

  if (passed.length === 0) {
    return { passedTriage: [], removedIds: [] };
  }

  logger.info({ count: passed.length }, 'Enrich node: fetching detail pages for triage-passed candidates');

  try {
    // Group candidates by platform for platform-specific enrichment
    const byPlatform = new Map<string, TriagedCandidate[]>();
    for (const candidate of passed) {
      const group = byPlatform.get(candidate.platform) ?? [];
      group.push(candidate);
      byPlatform.set(candidate.platform, group);
    }

    const allEnriched: ScrapedCandidate[] = [];
    const allRemovedIds: string[] = [];

    for (const [platform, candidates] of byPlatform) {
      const integration = getIntegration(platform);
      if (!integration) {
        logger.warn({ platform }, 'Enrich: no integration for platform, keeping search data');
        allEnriched.push(...candidates);
        continue;
      }

      const { enriched, removedIds } = await integration.enrich(candidates);
      allEnriched.push(...enriched);
      allRemovedIds.push(...removedIds);
    }

    // Map enriched ScrapedCandidates back to TriagedCandidates by
    // re-attaching the triageResult from the original passed list
    const triageMap = new Map(passed.map((p) => [p.externalId, p.triageResult]));
    const enrichedWithTriage: TriagedCandidate[] = allEnriched.map((e) => ({
      ...e,
      triageResult: triageMap.get(e.externalId)!,
    }));

    return { passedTriage: enrichedWithTriage, removedIds: allRemovedIds };
  } catch (err) {
    logger.error({ error: String(err) }, 'Enrich node failed');
    return {
      passedTriage: passed, // keep search data on failure
      removedIds: [],
      errors: [{ node: 'enrich', message: String(err), timestamp: new Date().toISOString() }],
    };
  }
}
