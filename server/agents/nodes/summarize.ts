import { db } from '../../db/index.js';
import { agentRuns } from '../../db/schema.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

export async function summarizeRun(state: AgentState): Promise<Partial<AgentState>> {
  const summary = {
    scraped: state.scrapedCandidates.length,
    triaged: state.triagedCandidates.length,
    passedTriage: state.passedTriage.length,
    reconciled: state.reconciledCount,
    evaluated: state.evaluatedCandidates.length,
    qualified: state.qualifiedListings.length,
    rendered: state.conceptRenders.length,
    errors: state.errors.length,
  };

  // Write agent run record to DB
  try {
    await db.insert(agentRuns).values({
      runId: state.runId,
      startedAt: new Date(state.startedAt),
      completedAt: new Date(),
      status: state.errors.length > 0 && summary.evaluated === 0 ? 'failed' : 'completed',
      scraped: summary.scraped,
      triaged: summary.triaged,
      passedTriage: summary.passedTriage,
      evaluated: summary.evaluated,
      qualified: summary.qualified,
      rendered: summary.rendered,
      errorsCount: summary.errors,
      errorDetails: state.errors.length > 0 ? JSON.stringify(state.errors) : null,
    }).onConflictDoNothing(); // safety: don't crash if run was already recorded
  } catch (err) {
    logger.error({ error: String(err) }, 'Summarize: failed to write agent run record');
  }

  logger.info(summary, 'Agent pipeline run complete');

  return { summary };
}
