/**
 * Tests the evaluate node's per-platform budget allocation.
 * Verifies that each platform gets its own maxEvals budget.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('../../db/index.js', () => {
  const chain: any = {};
  for (const m of ['select', 'from', 'where', 'insert', 'values', 'update', 'set', 'returning', 'onConflictDoNothing']) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: any) => resolve([{ id: 999 }]);
  chain.catch = () => chain;
  return {
    db: new Proxy({}, { get: () => () => chain }),
  };
});

vi.mock('../../db/schema.js', () => ({
  listings: { id: 'id', platform: 'platform', externalId: 'external_id' },
  listingImages: { id: 'id', listingId: 'listing_id' },
}));

vi.mock('../../analysis/vision.js', () => ({
  analyzeListing: vi.fn().mockResolvedValue({
    furniture_type: 'dresser',
    furniture_style: 'mid-century',
    condition_score: 7,
    condition_notes: 'Good',
    wood_species: 'oak',
    wood_confidence: 0.8,
    species_discrepancy: null,
    notable_features: [],
    damage_items: [],
    refinishing_potential: 'high',
    flip_recommendation: 'buy',
    refinishing_profit_verdict: 'Good flip potential',
  }),
}));

vi.mock('../../analysis/pricing.js', () => ({
  calculatePricing: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../images/downloader.js', () => ({
  downloadListingImages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../images/processor.js', () => ({
  processListingImages: vi.fn().mockResolvedValue(undefined),
  getImageBase64: vi.fn(),
}));

vi.mock('../../lib/s3.js', () => ({
  downloadFromS3: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  deleteFromS3: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config.js', () => ({
  agentConfig: {
    maxEvals: 2, // Low cap to test budget exhaustion
    dealScoreThreshold: 1.3,
    flipRecommendationThreshold: ['strong_buy', 'buy'],
  },
}));

vi.mock('../progress.js', () => ({
  reportProgress: vi.fn(),
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { evaluateCandidates } from '../nodes/evaluate.js';
import type { AgentState, TriagedCandidate } from '../state.js';

function makeTriaged(platform: string, id: string): TriagedCandidate {
  return {
    externalId: id,
    platform,
    url: `https://example.com/${id}`,
    title: `Test ${id}`,
    askingPrice: 100,
    location: 'Seattle',
    imageUrls: [],
    triageResult: {
      isWoodFurniture: true,
      hasFlipPotential: true,
      furnitureType: 'dresser',
      reasoning: 'test',
      confidenceScore: 0.9,
    },
  };
}

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

describe('evaluate per-platform budget', () => {
  it('evaluates candidates from both platforms up to per-platform cap', async () => {
    const passedTriage = [
      makeTriaged('craigslist', 'cl-1'),
      makeTriaged('craigslist', 'cl-2'),
      makeTriaged('craigslist', 'cl-3'), // over cap for CL
      makeTriaged('offerup', 'ou-1'),
      makeTriaged('offerup', 'ou-2'),
      makeTriaged('offerup', 'ou-3'), // over cap for OU
    ];

    const result = await evaluateCandidates(makeState({ passedTriage }));

    // maxEvals=2 per platform, so 2 CL + 2 OU = 4 total
    // (3rd from each platform should be skipped)
    expect(result.evaluatedCandidates!.length).toBeLessThanOrEqual(4);

    // Both platforms should be represented
    const platforms = new Set(result.evaluatedCandidates!.map((e) => e.platform));
    expect(platforms.size).toBe(2);
    expect(platforms.has('craigslist')).toBe(true);
    expect(platforms.has('offerup')).toBe(true);
  });

  it('respects existing per-platform counts', async () => {
    const passedTriage = [
      makeTriaged('craigslist', 'cl-new-1'),
      makeTriaged('craigslist', 'cl-new-2'),
      makeTriaged('offerup', 'ou-new-1'),
    ];

    // CL already used 1 of 2, OU used 0 of 2
    const result = await evaluateCandidates(makeState({
      passedTriage,
      evalCount: { craigslist: 1 },
    }));

    // CL has 1 remaining slot, OU has 2
    // Should evaluate 1 CL + 1 OU = up to 2 (or 3 if OU gets both)
    const clEvals = result.evaluatedCandidates!.filter((e) => e.platform === 'craigslist');
    expect(clEvals.length).toBeLessThanOrEqual(1);
  });

  it('skips platform when budget exhausted', async () => {
    const passedTriage = [
      makeTriaged('craigslist', 'cl-skip-1'),
      makeTriaged('offerup', 'ou-ok-1'),
    ];

    const result = await evaluateCandidates(makeState({
      passedTriage,
      evalCount: { craigslist: 2 }, // CL budget fully used
    }));

    // CL should be skipped, only OU evaluated
    const clEvals = result.evaluatedCandidates!.filter((e) => e.platform === 'craigslist');
    expect(clEvals.length).toBe(0);
  });
});
