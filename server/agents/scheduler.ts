import crypto from 'crypto';
import { agentPipeline, initCheckpointer } from './graph.js';
import { agentConfig, refreshAgentConfig } from './config.js';
import logger from '../lib/logger.js';

let running = false;
let runStartedAt: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const RUN_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

async function runOnce(): Promise<void> {
  if (running) {
    if (runStartedAt && Date.now() - runStartedAt > RUN_TIMEOUT_MS) {
      logger.error({ runStartedAt: new Date(runStartedAt).toISOString() }, 'Agent scheduler: previous run exceeded timeout, resetting');
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
  const startedAt = new Date().toISOString();

  logger.info({ runId }, 'Agent scheduler: starting pipeline run');

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

  runOnce();

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
