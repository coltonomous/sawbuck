/**
 * Agent pipeline runner.
 * Usage: npm run agent
 *
 * Runs the autonomous LangGraph agent pipeline that scrapes Craigslist,
 * triages candidates, evaluates with vision, and generates concept renders.
 */

import crypto from 'crypto';
import { agentPipeline } from '../server/agents/graph.js';
import logger from '../server/lib/logger.js';

async function run() {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  logger.info({ runId }, 'Starting agent pipeline run');

  try {
    const result = await agentPipeline.invoke(
      {
        runId,
        startedAt,
      },
      {
        configurable: { thread_id: runId },
      },
    );

    if (result.summary) {
      logger.info({ runId, summary: result.summary }, 'Agent pipeline completed');
    }

    if (result.errors?.length > 0) {
      logger.warn({ runId, errorCount: result.errors.length }, 'Agent pipeline completed with errors');
    }
  } catch (err) {
    logger.error({ runId, error: String(err) }, 'Agent pipeline failed');
    process.exitCode = 1;
  } finally {
    // cleanup if needed
  }
}

run();
