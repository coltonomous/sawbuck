import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Send } from '@langchain/langgraph';

// Mock registry
const mockPlatforms = [
  { platform: 'craigslist', discover: vi.fn(), enrich: vi.fn() },
];
const mockRegions = [
  { id: 1, name: 'seattle', latitude: 47.6, longitude: -122.3, radiusMiles: 30, clSubdomain: 'seattle' },
  { id: 2, name: 'portland', latitude: 45.5, longitude: -122.7, radiusMiles: 25, clSubdomain: 'portland' },
];

vi.mock('../../integrations/registry.js', () => ({
  getEnabledPlatforms: () => Promise.resolve(mockPlatforms),
  getEnabledRegions: () => Promise.resolve(mockRegions),
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { dispatchScrapes, afterScrapesMerge } from '../nodes/scrape.js';
import type { AgentState } from '../state.js';

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    runId: 'test',
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
    qualifiedCount: 0,
    conceptsRendered: 0,
    scrapeAttempts: 0,
    seenExternalIds: [],
    scrapeTask: null,
    errors: [],
    summary: null,
    ...overrides,
  };
}

describe('dispatchScrapes', () => {
  it('returns one Send per (platform x region) combination', async () => {
    const sends = await dispatchScrapes(makeState());

    expect(sends).toHaveLength(2); // 1 platform x 2 regions
    expect(sends[0]).toBeInstanceOf(Send);
    expect(sends[1]).toBeInstanceOf(Send);
  });

  it('passes correct scrapeTask with page from scrapeAttempts', async () => {
    const sends = await dispatchScrapes(makeState({ scrapeAttempts: 2 }));

    // Check that sends contain the right metadata
    expect(sends).toHaveLength(2);
    // The Send constructor takes (node, args), we can inspect the args
    const send0 = sends[0] as any;
    expect(send0.node).toBe('scrapeOne');
    expect(send0.args.scrapeTask.platform).toBe('craigslist');
    expect(send0.args.scrapeTask.page).toBe(2);
  });

  it('returns empty array when no platforms enabled', async () => {
    mockPlatforms.length = 0;
    const sends = await dispatchScrapes(makeState());
    expect(sends).toHaveLength(0);
    mockPlatforms.push({ platform: 'craigslist', discover: vi.fn(), enrich: vi.fn() });
  });
});

describe('afterScrapesMerge', () => {
  it('increments scrapeAttempts', async () => {
    const result = await afterScrapesMerge(makeState({ scrapeAttempts: 1 }));
    expect(result.scrapeAttempts).toBe(2);
  });
});
