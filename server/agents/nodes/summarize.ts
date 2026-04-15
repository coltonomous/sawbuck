import { db } from '../../db/index.js';
import { agentRuns } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

export async function summarizeRun(state: AgentState): Promise<Partial<AgentState>> {
  const summary = {
    scraped: state.scrapedCandidates.length,
    triaged: state.triagedCandidates.length,
    passedTriage: state.passedTriage.length,
    reconciled: state.reconciledCount,
    evaluated: state.evaluatedCandidates.length,
    qualified: state.qualifiedCount,
    rendered: state.conceptRenders.length,
    errors: state.errors.length,
  };

  const finalStatus = state.errors.length > 0 && summary.evaluated === 0 ? 'failed' : 'completed';

  // Finalize the agent run record (created by scheduler at start of run)
  try {
    const updated = await db.update(agentRuns)
      .set({
        completedAt: new Date(),
        status: finalStatus,
        scraped: summary.scraped,
        triaged: summary.triaged,
        passedTriage: summary.passedTriage,
        evaluated: summary.evaluated,
        qualified: summary.qualified,
        rendered: summary.rendered,
        errorsCount: summary.errors,
        errorDetails: state.errors.length > 0 ? state.errors : null,
      })
      .where(eq(agentRuns.runId, state.runId));

    // Fallback: if no row was updated (scheduler didn't create it), insert
    if (!updated.rowCount) {
      await db.insert(agentRuns).values({
        runId: state.runId,
        startedAt: new Date(state.startedAt),
        completedAt: new Date(),
        status: finalStatus,
        scraped: summary.scraped,
        triaged: summary.triaged,
        passedTriage: summary.passedTriage,
        evaluated: summary.evaluated,
        qualified: summary.qualified,
        rendered: summary.rendered,
        errorsCount: summary.errors,
        errorDetails: state.errors.length > 0 ? state.errors : null,
      }).onConflictDoNothing();
    }
  } catch (err) {
    logger.error({ error: String(err) }, 'Summarize: failed to write agent run record');
  }

  logger.info(summary, 'Agent pipeline run complete');

  return { summary };
}
