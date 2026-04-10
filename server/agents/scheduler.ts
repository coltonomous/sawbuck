import crypto from 'crypto';
import { agentPipeline } from './graph.js';
import { agentConfig } from './config.js';
import logger from '../lib/logger.js';

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function runOnce(): Promise<void> {
  if (running) {
    logger.info('Agent scheduler: run already in progress, skipping');
    return;
  }

  running = true;
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
  }
}

export function startScheduler(): void {
  if (timer) {
    logger.warn('Agent scheduler already started');
    return;
  }

  logger.info({ intervalMs: agentConfig.runIntervalMs }, 'Agent scheduler: starting');

  // Run immediately on start, then at interval
  runOnce();

  timer = setInterval(runOnce, agentConfig.runIntervalMs);
  timer.unref(); // allow graceful shutdown
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Agent scheduler: stopped');
  }
}
