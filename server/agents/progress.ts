/**
 * Lightweight helper for nodes to report incremental progress to the
 * agent_runs DB row. Each call is a single UPDATE — fire-and-forget
 * so it never blocks or fails the pipeline.
 */

import { db } from '../db/index.js';
import { agentRuns } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger.js';

type ProgressFields = {
  scraped?: number;
  triaged?: number;
  passedTriage?: number;
  evaluated?: number;
  qualified?: number;
  rendered?: number;
  errorsCount?: number;
};

export function reportProgress(runId: string, fields: ProgressFields): void {
  db.update(agentRuns)
    .set(fields)
    .where(eq(agentRuns.runId, runId))
    .then(() => {})
    .catch((err) => {
      logger.debug({ runId, error: String(err) }, 'Progress update failed (non-fatal)');
    });
}
