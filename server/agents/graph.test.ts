import { describe, it, expect, vi } from 'vitest';

// Mock agentConfig
vi.mock('./config.js', () => ({
  agentConfig: {
    maxEvals: 10,
    flipRecommendationThreshold: ['strong_buy', 'buy'],
    triageConfidenceThreshold: 0.6,
    dealScoreThreshold: 1.3,
  },
}));

import { afterTriage, afterPlanOptions, MAX_SCRAPE_ATTEMPTS, MIN_QUALIFIED_TARGET } from './graph.js';
import type { AgentState } from './state.js';

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


describe('afterTriage', () => {
  it('routes to enrich when candidates passed', () => {
    expect(afterTriage(makeState({ passedTriage: [{} as any], evalCount: {}}))).toBe('enrich');
  });

  it('retries scrape when nothing passed and attempts remain', () => {
    expect(afterTriage(makeState({ passedTriage: [], scrapeAttempts: { craigslist: 1 } }))).toBe('dispatchScrapes');
  });

  it('summarizes when nothing passed and scrape exhausted', () => {
    expect(afterTriage(makeState({ passedTriage: [], scrapeAttempts: { craigslist: MAX_SCRAPE_ATTEMPTS } }))).toBe('summarize');
  });

  it('summarizes when eval cap already hit', () => {
    expect(afterTriage(makeState({ passedTriage: [{} as any], evalCount: { craigslist: 10 } }))).toBe('summarize');
  });
});



describe('afterPlanOptions', () => {
  it('loops to scrape when under target', () => {
    expect(afterPlanOptions(makeState({ listingsWithOptions: [{} as any], qualifiedCount: 0, evalCount: { craigslist: 3 }, scrapeAttempts: { craigslist: 1 } }))).toBe('dispatchScrapes');
  });

  it('summarizes when target met', () => {
    expect(afterPlanOptions(makeState({ listingsWithOptions: [{} as any], qualifiedCount: MIN_QUALIFIED_TARGET, evalCount: { craigslist: 3 }, scrapeAttempts: { craigslist: 1 } }))).toBe('summarize');
  });

  it('summarizes when no listings with options and target met', () => {
    expect(afterPlanOptions(makeState({ listingsWithOptions: [], qualifiedCount: MIN_QUALIFIED_TARGET }))).toBe('summarize');
  });

  it('loops to scrape when no listings with options and under target', () => {
    expect(afterPlanOptions(makeState({ listingsWithOptions: [], qualifiedCount: 0, evalCount: { craigslist: 3 }, scrapeAttempts: { craigslist: 1 } }))).toBe('dispatchScrapes');
  });
});
