import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Send, Command } from '@langchain/langgraph';

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
    scrapeAttempts: {},
    seenExternalIds: [],
    scrapeTask: null,
    errors: [],
    summary: null,
    ...overrides,
  };
}

describe('dispatchScrapes', () => {
  it('returns Command with Send[] goto for each (platform x region)', async () => {
    const cmd = await dispatchScrapes(makeState());

    expect(cmd).toBeInstanceOf(Command);
    const goto = (cmd as any).goto as Send[];
    expect(goto).toHaveLength(2); // 1 platform x 2 regions
    expect(goto[0]).toBeInstanceOf(Send);
    expect(goto[1]).toBeInstanceOf(Send);
  });

  it('passes correct scrapeTask with page from scrapeAttempts', async () => {
    const cmd = await dispatchScrapes(makeState({ scrapeAttempts: { craigslist: 2 } }));

    const goto = (cmd as any).goto as Send[];
    expect(goto).toHaveLength(2);
    const send0 = goto[0] as any;
    expect(send0.node).toBe('scrapeOne');
    expect(send0.args.scrapeTask.platform).toBe('craigslist');
    expect(send0.args.scrapeTask.page).toBe(2);
  });

  it('returns Command with goto mergeScrapes when no platforms enabled', async () => {
    mockPlatforms.length = 0;
    const cmd = await dispatchScrapes(makeState());
    expect(cmd).toBeInstanceOf(Command);
    expect((cmd as any).goto).toContain('mergeScrapes');
    mockPlatforms.push({ platform: 'craigslist', discover: vi.fn(), enrich: vi.fn() });
  });
});

describe('afterScrapesMerge', () => {
  it('increments scrapeAttempts', async () => {
    const result = await afterScrapesMerge(makeState({
      scrapeAttempts: { craigslist: 0 },
      scrapedCandidates: [{ externalId: '1', platform: 'craigslist', url: '', title: '', askingPrice: null, location: '', imageUrls: [] }],
    }));
    expect(result.scrapeAttempts).toEqual({ craigslist: 1 });
  });
});
