/**
 * Background worker process — runs agent pipeline, image cleanup,
 * listing reconciliation, and RAG knowledge base management.
 *
 * Separate from the web server so a long-running pipeline can't
 * starve HTTP requests, and either process can restart independently.
 *
 * Usage:
 *   tsx server/worker.ts          # development
 *   node --loader tsx server/worker.ts  # production
 */

import { env } from './lib/env.js';
import { pool } from './db/index.js';
import logger from './lib/logger.js';
import { bootstrapKnowledgeBase } from './rag/bootstrap.js';
import { cleanupOrphanedImages } from './images/cleanup.js';
import { startScheduler, stopScheduler } from './agents/scheduler.js';
import { recordJobRun, isJobOverdue } from './lib/metrics.js';

logger.info('Worker process starting');

// ── RAG knowledge base ─────────────────────────────────────────────
bootstrapKnowledgeBase();

// ── Image cleanup (daily) ──────────────────────────────────────────
const IMAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function runImageCleanup() {
  const start = Date.now();
  cleanupOrphanedImages().then(() => {
    recordJobRun('image-cleanup', 'success', Date.now() - start);
  }).catch((err) => {
    recordJobRun('image-cleanup', 'failure', Date.now() - start);
    logger.error({ err }, 'Scheduled image cleanup failed');
  });
}

setTimeout(runImageCleanup, 30_000);
const cleanupTimer = setInterval(runImageCleanup, IMAGE_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

// ── Agent pipeline scheduler ───────────────────────────────────────
if (env.hasAws) {
  setTimeout(() => startScheduler(), 10_000);
} else {
  logger.info('AWS_REGION not set — agent scheduler disabled');
}

// ── Reconcile stale listings (every 6 hours) ───────────────────────
const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RECONCILE_OVERDUE_MS = 12 * 60 * 60 * 1000;

async function runReconcile() {
  const start = Date.now();
  try {
    const { reconcileListings } = await import('./agents/nodes/reconcile.js');
    const result = await reconcileListings({
      runId: 'reconcile-' + Date.now(),
      startedAt: new Date().toISOString(),
      scrapedCandidates: [],
      triagedCandidates: [],
      passedTriage: [],
      evaluatedCandidates: [],
      qualifiedListings: [],
      listingsWithOptions: [],
      conceptRenders: [],
      removedIds: [],
      reconciledCount: 0,
      triageCount: {},
      evalCount: {},
      qualifiedCount: 0,
      conceptsRendered: 0,
      scrapeAttempts: {},
      seenExternalIds: [],
      scrapeTask: null,
      errors: [],
      summary: null,
    });

    const durationMs = Date.now() - start;
    recordJobRun('reconcile', 'success', durationMs, {
      reconciled: result.reconciledCount ?? 0,
      errors: result.errors?.length ?? 0,
    });
    logger.info(
      { reconciled: result.reconciledCount, durationMs, errors: result.errors?.length ?? 0 },
      'Standalone reconcile complete',
    );

    if (result.errors && result.errors.length > 0) {
      logger.warn({ errors: result.errors }, 'Reconcile completed with errors');
    }
  } catch (err) {
    recordJobRun('reconcile', 'failure', Date.now() - start);
    logger.error({ err }, 'Standalone reconcile failed');
  }
}

setTimeout(runReconcile, 2 * 60_000);
const reconcileTimer = setInterval(runReconcile, RECONCILE_INTERVAL_MS);
reconcileTimer.unref();

// Periodic overdue check
const overdueCheckTimer = setInterval(() => {
  if (isJobOverdue('reconcile', RECONCILE_OVERDUE_MS)) {
    logger.warn('Reconcile job is overdue — last successful run was more than 12 hours ago');
  }
}, 60 * 60 * 1000);
overdueCheckTimer.unref();

// ── Graceful shutdown ──────────────────────────────────────────────
async function shutdown() {
  logger.info('Worker shutting down...');
  clearInterval(cleanupTimer);
  clearInterval(reconcileTimer);
  clearInterval(overdueCheckTimer);
  stopScheduler();

  try {
    await pool.end();
    logger.info('Connection pool drained');
  } catch (err) {
    logger.error({ err }, 'Failed to drain connection pool');
  }

  logger.info('Worker stopped');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
