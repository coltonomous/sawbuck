/**
 * Tests the scheduler's recovery paths: a failed config refresh, a hung run,
 * a timed-out run that settles late, and cron intervals too long for a
 * single setTimeout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refreshAgentConfig: vi.fn(),
  agentConfig: { cronSchedule: '0 */4 * * *', schedulerEnabled: true },
}));

vi.mock('../graph.js', () => ({
  agentPipeline: { invoke: mocks.invoke },
  initCheckpointer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config.js', () => ({
  agentConfig: mocks.agentConfig,
  refreshAgentConfig: mocks.refreshAgentConfig,
}));

vi.mock('../../db/index.js', () => {
  const chain: any = {};
  for (const m of ['insert', 'values', 'update', 'set', 'where', 'onConflictDoNothing']) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: any) => resolve({ rowCount: 0 });
  chain.catch = () => chain;
  return { db: new Proxy({}, { get: () => () => chain }) };
});

vi.mock('../../db/schema.js', () => ({
  agentRuns: { runId: 'run_id', status: 'status' },
}));

vi.mock('../../lib/metrics.js', () => ({ recordJobRun: vi.fn() }));

vi.mock('../../rag/ingest/worker.js', () => ({
  processSourceQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const HOUR = 60 * 60 * 1000;

async function loadScheduler() {
  vi.resetModules();
  return import('../scheduler.js');
}

describe('agent scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:30:00Z'));
    mocks.invoke.mockReset().mockResolvedValue({ summary: null });
    mocks.refreshAgentConfig.mockReset().mockResolvedValue(undefined);
    mocks.agentConfig.cronSchedule = '0 */4 * * *';
    mocks.agentConfig.schedulerEnabled = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('still runs and reschedules when the config refresh fails', async () => {
    const scheduler = await loadScheduler();
    await scheduler.startScheduler();

    mocks.refreshAgentConfig.mockRejectedValueOnce(new Error('db blip'));
    expect(scheduler.triggerRun()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    const status = scheduler.getScheduleStatus();
    expect(status.running).toBe(false);
    expect(status.nextRunAt).not.toBeNull();
    expect(scheduler.triggerRun()).toBe(true);

    scheduler.stopScheduler();
  });

  it('resets a hung scheduled run on the next tick after the timeout', async () => {
    const scheduler = await loadScheduler();
    await scheduler.startScheduler();

    // The 04:00 tick starts a run that never settles
    mocks.invoke.mockReturnValueOnce(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(4 * HOUR);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(scheduler.getScheduleStatus().running).toBe(true);
    expect(scheduler.triggerRun()).toBe(false);

    // The 08:00 tick lands past the 1h timeout
    await vi.advanceTimersByTimeAsync(4 * HOUR);

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(scheduler.getScheduleStatus().running).toBe(false);

    scheduler.stopScheduler();
  });

  it('lets a manual trigger reset a hung run while automated runs are paused', async () => {
    mocks.agentConfig.schedulerEnabled = false;
    const scheduler = await loadScheduler();
    await scheduler.startScheduler();

    mocks.invoke.mockReturnValueOnce(new Promise(() => {}));
    scheduler.triggerRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.triggerRun()).toBe(false);

    vi.setSystemTime(Date.now() + 2 * HOUR);
    expect(scheduler.triggerRun()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(scheduler.getScheduleStatus().running).toBe(false);

    scheduler.stopScheduler();
  });

  it('does not let a timed-out run clobber the run that replaced it', async () => {
    mocks.agentConfig.cronSchedule = '0 * * * *';
    const scheduler = await loadScheduler();
    await scheduler.startScheduler();

    let settleFirst: (v: unknown) => void = () => {};
    mocks.invoke
      .mockReturnValueOnce(new Promise((resolve) => { settleFirst = resolve; }))
      .mockReturnValueOnce(new Promise(() => {}));

    scheduler.triggerRun();
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);

    settleFirst({ summary: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(scheduler.getScheduleStatus().running).toBe(true);
    expect(scheduler.triggerRun()).toBe(false);

    scheduler.stopScheduler();
  });

  it('does not fire early when the next cron tick is beyond setTimeout range', async () => {
    mocks.agentConfig.cronSchedule = '0 0 1 1 *'; // yearly
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    const scheduler = await loadScheduler();
    await scheduler.startScheduler();
    const { nextRunAt } = scheduler.getScheduleStatus();

    await vi.advanceTimersByTimeAsync(2 ** 31);

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(scheduler.getScheduleStatus().nextRunAt).toBe(nextRunAt);

    scheduler.stopScheduler();
  });

  it('logs and skips scheduling for an invalid cron instead of throwing', async () => {
    mocks.agentConfig.cronSchedule = 'not a cron';
    const scheduler = await loadScheduler();

    await expect(scheduler.startScheduler()).resolves.toBeUndefined();
    expect(scheduler.getScheduleStatus().nextRunAt).toBeNull();

    scheduler.stopScheduler();
  });
});
