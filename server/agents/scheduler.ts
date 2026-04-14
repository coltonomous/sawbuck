import crypto from 'crypto';
import { agentPipeline, initCheckpointer } from './graph.js';
import { agentConfig, refreshAgentConfig } from './config.js';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger.js';

let running = false;
let runStartedAt: number | null = null;
let currentRunId: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const RUN_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

async function runOnce(): Promise<void> {
  if (running) {
    if (runStartedAt && Date.now() - runStartedAt > RUN_TIMEOUT_MS) {
      logger.error({ runStartedAt: new Date(runStartedAt).toISOString() }, 'Agent scheduler: previous run exceeded timeout, resetting');
      // Mark the timed-out run as failed in the DB
      if (currentRunId) {
        db.update(agentRuns)
          .set({ status: 'failed', completedAt: new Date(), errorsCount: 1, errorDetails: JSON.stringify([{ node: 'scheduler', message: 'Run exceeded 1 hour timeout', timestamp: new Date().toISOString() }]) })
          .where(eq(agentRuns.runId, currentRunId))
          .catch((err) => logger.warn({ error: String(err) }, 'Failed to mark timed-out run'));
      }
      running = false;
    } else {
      logger.info('Agent scheduler: run already in progress, skipping');
      return;
    }
  }

  running = true;
  runStartedAt = Date.now();

  // Refresh config from DB before each run (picks up admin UI changes)
  await refreshAgentConfig();

  const runId = crypto.randomUUID();
  currentRunId = runId;
  const startedAt = new Date().toISOString();

  logger.info({ runId }, 'Agent scheduler: starting pipeline run');

  // Create the run record upfront so the UI can see it's running
  try {
    await db.insert(agentRuns).values({
      runId,
      startedAt: new Date(startedAt),
      status: 'running',
    }).onConflictDoNothing();
  } catch (err) {
    logger.warn({ runId, error: String(err) }, 'Agent scheduler: failed to create initial run record');
  }

  try {
    const result = await agentPipeline.invoke(
      { runId, startedAt },
      { configurable: { thread_id: runId } },
    );

    if (result.summary) {
      logger.info({ runId, summary: result.summary }, 'Agent scheduler: run complete');
    }
  } catch (err) {
    logger.error({ runId, error: String(err) }, 'Agent scheduler: run failed');
  } finally {
    running = false;
    runStartedAt = null;
    currentRunId = null;
  }
}

/**
 * Mark any agent_runs stuck in 'running' status as 'failed'.
 * These are orphans from a previous process that crashed or was restarted.
 */
async function cleanupStaleRuns(): Promise<void> {
  try {
    const result = await db.update(agentRuns)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorsCount: 1,
        errorDetails: JSON.stringify([{ node: 'scheduler', message: 'Marked as failed on startup (previous process died)', timestamp: new Date().toISOString() }]),
      })
      .where(eq(agentRuns.status, 'running'));

    if (result.rowCount && result.rowCount > 0) {
      logger.info({ cleaned: result.rowCount }, 'Agent scheduler: marked stale runs as failed');
    }
  } catch (err) {
    logger.warn({ error: String(err) }, 'Agent scheduler: failed to clean up stale runs');
  }
}

export async function startScheduler(): Promise<void> {
  if (timer) {
    logger.warn('Agent scheduler already started');
    return;
  }

  const intervalMs = agentConfig.runIntervalMs;
  logger.info({ intervalMs }, 'Agent scheduler: starting');

  // Ensure checkpoint tables exist before first run
  try {
    await initCheckpointer();
  } catch (err) {
    logger.error({ error: String(err) }, 'Agent scheduler: failed to initialize checkpointer');
  }

  // Clean up orphaned 'running' rows from previous process crashes
  await cleanupStaleRuns();

  // Don't run immediately on startup/deploy — wait for the first interval
  timer = setInterval(runOnce, intervalMs);
  timer.unref();
}

/** Manually trigger a pipeline run. Returns false if one is already running. */
export function triggerRun(): boolean {
  if (running) return false;
  runOnce();
  return true;
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Agent scheduler: stopped');
  }
}
