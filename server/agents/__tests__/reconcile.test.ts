import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock anti-blocking to skip delays
vi.mock('../anti-blocking.js', () => ({
  AntiBlockingController: class {
    async beforeRequest() {}
    onSuccess() {}
    onError() {}
  },
}));

// Mock logger
vi.mock('../../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Track DB updates
const dbUpdates: { status: string; ids: number[] }[] = [];
let mockDbListings: { id: number; externalId: string; url: string }[] = [];

vi.mock('../../db/index.js', () => {
  const makeSelectChain = () => {
    const chain: any = {};
    for (const m of ['select', 'from', 'where', 'limit', 'orderBy']) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: any) => resolve(mockDbListings);
    chain.catch = () => chain;
    return chain;
  };

  const makeUpdateChain = () => {
    let setPayload: any = null;
    const chain: any = {};
    chain.update = () => chain;
    chain.set = (payload: any) => { setPayload = { ...payload }; return chain; };
    chain.where = () => {
      if (setPayload) dbUpdates.push({ status: setPayload.status, ids: [] });
      return chain;
    };
    chain.then = (resolve: any) => resolve(undefined);
    chain.catch = () => chain;
    return chain;
  };

  return {
    db: new Proxy({}, {
      get(_t, prop) {
        if (prop === 'select') return () => makeSelectChain();
        if (prop === 'update') return () => makeUpdateChain();
        return () => ({});
      },
    }),
  };
});

vi.mock('../../db/schema.js', () => ({
  listings: {
    id: 'id', externalId: 'external_id', url: 'url',
    platform: 'platform', userId: 'user_id', status: 'status',
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { reconcileListings } from '../nodes/reconcile.js';
import type { AgentState } from '../state.js';

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    runId: 'test-run',
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
    triageCount: 0,
    evalCount: 0,
    conceptsRendered: 0,
    scrapeAttempts: 1,
    seenExternalIds: [],
    errors: [],
    summary: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbUpdates.length = 0;
  mockDbListings = [];
});

describe('reconcileListings', () => {
  it('counts enrichment 404s in reconciledCount', async () => {
    const result = await reconcileListings(makeState({
      removedIds: ['gone-1', 'gone-2', 'gone-3'],
      seenExternalIds: ['a', 'b'],
    }));

    expect(result.reconciledCount).toBeGreaterThanOrEqual(3);
  });

  it('returns 0 when no removals and no RSS IDs', async () => {
    const result = await reconcileListings(makeState({
      removedIds: [],
      seenExternalIds: [],
    }));

    expect(result.reconciledCount).toBe(0);
  });

  it('probes DB listings missing from RSS and marks 404s as removed', async () => {
    mockDbListings = [
      { id: 100, externalId: 'old-1', url: 'https://seattle.craigslist.org/old/1.html' },
    ];

    // HEAD returns 404
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await reconcileListings(makeState({
      seenExternalIds: ['new-1', 'new-2'],
    }));

    expect(result.reconciledCount).toBeGreaterThanOrEqual(1);
    expect(dbUpdates.length).toBeGreaterThan(0);
    expect(dbUpdates[0].status).toBe('removed');
  });

  it('probes DB listings and detects deletion notice pages', async () => {
    mockDbListings = [
      { id: 200, externalId: 'deleted-1', url: 'https://seattle.craigslist.org/d/200.html' },
    ];

    // HEAD returns 200 (page exists)
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    // GET returns deletion notice
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><body>This posting has been deleted by its author.</body></html>'),
    });

    const result = await reconcileListings(makeState({
      seenExternalIds: ['new-1'],
    }));

    expect(result.reconciledCount).toBeGreaterThanOrEqual(1);
  });

  it('does not mark listings that are still live', async () => {
    mockDbListings = [
      { id: 300, externalId: 'alive-1', url: 'https://seattle.craigslist.org/d/300.html' },
    ];

    // HEAD returns 200
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    // GET returns normal page
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><body><section id="postingbody">Still here</section></body></html>'),
    });

    const result = await reconcileListings(makeState({
      seenExternalIds: ['new-1'],
    }));

    expect(dbUpdates).toHaveLength(0);
  });

  it('skips probe when no DB listings are missing from RSS', async () => {
    mockDbListings = [];

    const result = await reconcileListings(makeState({
      seenExternalIds: ['a', 'b'],
    }));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.reconciledCount).toBe(0);
  });

  it('handles network errors during probe gracefully', async () => {
    mockDbListings = [
      { id: 400, externalId: 'flaky-1', url: 'https://seattle.craigslist.org/d/400.html' },
    ];

    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await reconcileListings(makeState({
      seenExternalIds: ['new-1'],
    }));

    // Network errors are not removal signals
    expect(dbUpdates).toHaveLength(0);
    expect(result.errors).toHaveLength(0); // individual probe failures are not pipeline errors
  });
});
