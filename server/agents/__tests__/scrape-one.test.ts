import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDiscover = vi.fn();

vi.mock('../../integrations/registry.js', () => ({
  getIntegration: (platform: string) => {
    if (platform === 'craigslist') return { platform: 'craigslist', discover: mockDiscover, enrich: vi.fn() };
    return undefined;
  },
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { scrapeOne } from '../nodes/scrape-one.js';
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
    triageCount: {},
    evalCount: {},
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scrapeOne', () => {
  const testRegion = { id: 1, name: 'seattle', latitude: 47.6, longitude: -122.3, radiusMiles: 30, clSubdomain: 'seattle' };

  it('calls integration.discover and returns new candidates', async () => {
    mockDiscover.mockResolvedValueOnce([
      { externalId: '1', platform: 'craigslist', url: 'http://test/1', title: 'Chair', askingPrice: 50, location: 'Seattle', imageUrls: [] },
      { externalId: '2', platform: 'craigslist', url: 'http://test/2', title: 'Table', askingPrice: 100, location: 'Seattle', imageUrls: [] },
    ]);

    const result = await scrapeOne(makeState({
      scrapeTask: { platform: 'craigslist', region: testRegion, page: 0 },
    }));

    expect(mockDiscover).toHaveBeenCalledWith(testRegion, 0);
    expect(result.scrapedCandidates).toHaveLength(2);
    expect(result.seenExternalIds).toEqual(['1', '2']);
  });

  it('filters out already-seen external IDs', async () => {
    mockDiscover.mockResolvedValueOnce([
      { externalId: 'seen-1', platform: 'craigslist', url: 'http://test/1', title: 'Chair', askingPrice: 50, location: 'Seattle', imageUrls: [] },
      { externalId: 'new-1', platform: 'craigslist', url: 'http://test/2', title: 'Table', askingPrice: 100, location: 'Seattle', imageUrls: [] },
    ]);

    const result = await scrapeOne(makeState({
      scrapeTask: { platform: 'craigslist', region: testRegion, page: 0 },
      seenExternalIds: ['seen-1'],
    }));

    expect(result.scrapedCandidates).toHaveLength(1);
    expect(result.scrapedCandidates![0].externalId).toBe('new-1');
  });

  it('returns error when scrapeTask is null', async () => {
    const result = await scrapeOne(makeState({ scrapeTask: null }));
    expect(result.scrapedCandidates).toEqual([]);
  });

  it('returns error for unknown platform', async () => {
    const result = await scrapeOne(makeState({
      scrapeTask: { platform: 'unknown', region: testRegion, page: 0 },
    }));

    expect(result.scrapedCandidates).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].node).toBe('scrapeOne');
  });

  it('handles discover failure gracefully', async () => {
    mockDiscover.mockRejectedValueOnce(new Error('Network error'));

    const result = await scrapeOne(makeState({
      scrapeTask: { platform: 'craigslist', region: testRegion, page: 0 },
    }));

    expect(result.scrapedCandidates).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});
