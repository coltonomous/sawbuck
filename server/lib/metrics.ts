/**
 * Lightweight in-memory job health tracker.
 *
 * Tracks last run time, status, duration, and failure count for each
 * scheduled background job. Exposes an admin-queryable snapshot and
 * an overdue check for alerting.
 */

interface JobHealth {
  lastRunAt: Date | null;
  lastStatus: 'success' | 'failure';
  lastDurationMs: number;
  lastResult: Record<string, unknown> | null;
  totalRuns: number;
  totalFailures: number;
}

const jobs = new Map<string, JobHealth>();

/** Record a completed job run (success or failure). */
export function recordJobRun(
  name: string,
  status: 'success' | 'failure',
  durationMs: number,
  result?: Record<string, unknown>,
): void {
  const existing = jobs.get(name);
  jobs.set(name, {
    lastRunAt: new Date(),
    lastStatus: status,
    lastDurationMs: durationMs,
    lastResult: result ?? null,
    totalRuns: (existing?.totalRuns ?? 0) + 1,
    totalFailures: (existing?.totalFailures ?? 0) + (status === 'failure' ? 1 : 0),
  });
}

/** Check whether a job hasn't run within the expected interval. */
export function isJobOverdue(name: string, maxAgeMs: number): boolean {
  const health = jobs.get(name);
  if (!health?.lastRunAt) return true;
  return Date.now() - health.lastRunAt.getTime() > maxAgeMs;
}

/** Get health snapshot for a single job. */
export function getJobHealth(name: string): JobHealth | undefined {
  return jobs.get(name);
}

/** Get health snapshot for all tracked jobs. */
export function getAllJobHealth(): Record<string, JobHealth> {
  return Object.fromEntries(jobs);
}
