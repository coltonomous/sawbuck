import crypto from 'crypto';
import { agentPipeline, initCheckpointer } from './graph.js';
import { agentConfig, refreshAgentConfig } from './config.js';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger.js';
import { recordJobRun } from '../lib/metrics.js';
import { msUntilNext } from '../lib/cron.js';
import { processSourceQueue } from '../rag/ingest/worker.js';

let running = false;
let runStartedAt: number | null = null;
let currentRunId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let nextRunAt: number | null = null;

const RUN_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

async function runOnce(): Promise<void> {
  if (running) {
    if (runStartedAt && Date.now() - runStartedAt > RUN_TIMEOUT_MS) {
      logger.error({ runStartedAt: new Date(runStartedAt).toISOString() }, 'Agent scheduler: previous run exceeded timeout, resetting');
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

  await refreshAgentConfig();

  const runId = crypto.randomUUID();
  currentRunId = runId;
  const startedAt = new Date().toISOString();

  logger.info({ runId }, 'Agent scheduler: starting pipeline run');

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

    const durationMs = Date.now() - runStartedAt!;
    recordJobRun('agent-pipeline', 'success', durationMs, result.summary ? { ...result.summary } : undefined);
    if (result.summary) {
      logger.info({ runId, summary: result.summary }, 'Agent scheduler: run complete');
    }
    // Drain any knowledge gaps queued by discoverKnowledge during this run
    processSourceQueue().catch((err) =>
      logger.warn({ err: String(err) }, 'Agent scheduler: knowledge source queue drain failed (non-fatal)'),
    );
  } catch (err) {
    const durationMs = runStartedAt ? Date.now() - runStartedAt : 0;
    recordJobRun('agent-pipeline', 'failure', durationMs);
    logger.error({ runId, error: String(err) }, 'Agent scheduler: run failed');
  } finally {
    running = false;
    runStartedAt = null;
    currentRunId = null;
    scheduleNext();
  }
}

function scheduleNext(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  if (!agentConfig.schedulerEnabled) {
    nextRunAt = null;
    logger.info('Agent scheduler: automated runs paused (scheduler disabled) — nothing scheduled');
    return;
  }

  const cron = agentConfig.cronSchedule;
  const delayMs = msUntilNext(cron);
  const nextAt = new Date(Date.now() + delayMs);
  nextRunAt = nextAt.getTime();
  logger.info({ cron, nextAt: nextAt.toISOString(), delayMs }, 'Agent scheduler: next run scheduled');

  timer = setTimeout(runOnce, delayMs);
  timer.unref();
}

/** Current scheduler state, for admin display. */
export function getScheduleStatus(): {
  enabled: boolean;
  cron: string;
  nextRunAt: string | null;
  running: boolean;
} {
  return {
    enabled: agentConfig.schedulerEnabled,
    cron: agentConfig.cronSchedule,
    nextRunAt: nextRunAt ? new Date(nextRunAt).toISOString() : null,
    running,
  };
}

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
  if (started) {
    logger.warn('Agent scheduler already started');
    return;
  }
  started = true;

  logger.info({ cron: agentConfig.cronSchedule }, 'Agent scheduler: starting');

  try {
    await initCheckpointer();
  } catch (err) {
    logger.error({ error: String(err) }, 'Agent scheduler: failed to initialize checkpointer');
  }

  await cleanupStaleRuns();

  scheduleNext();
}

/** Restart the scheduler with the current cron schedule (called when config changes). */
export function restartScheduler(): void {
  if (!started) return;
  logger.info('Agent scheduler: restarting with updated schedule');
  scheduleNext();
}

/** Manually trigger a pipeline run. Returns false if one is already running. */
export function triggerRun(): boolean {
  if (running) return false;
  runOnce();
  return true;
}

export function stopScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  started = false;
  logger.info('Agent scheduler: stopped');
}
