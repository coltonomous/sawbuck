import { describe, it, expect, vi } from 'vitest';

// Mock agentConfig
vi.mock('./config.js', () => ({
  agentConfig: {
    maxEvals: 10,
    maxListingsRendered: 5,
    flipRecommendationThreshold: ['strong_buy', 'buy'],
    triageConfidenceThreshold: 0.6,
    dealScoreThreshold: 1.3,
  },
}));

import { afterTriage, afterReconcile, afterEvaluate, afterPlanOptions, afterRender, MAX_SCRAPE_ATTEMPTS, MIN_QUALIFIED_TARGET } from './graph.js';
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

describe('afterEvaluate', () => {
  it('routes to discoverKnowledge when qualified listings exist', () => {
    expect(afterEvaluate(makeState({ qualifiedListings: [{} as any] }))).toBe('discoverKnowledge');
  });

  it('loops to scrape when no qualified but under caps', () => {
    expect(afterEvaluate(makeState({ qualifiedListings: [], evalCount: 3, scrapeAttempts: 1 }))).toBe('dispatchScrapes');
  });

  it('summarizes when no qualified and eval cap hit', () => {
    expect(afterEvaluate(makeState({ qualifiedListings: [], evalCount: 10, scrapeAttempts: 1 }))).toBe('summarize');
  });

  it('summarizes when no qualified and scrape attempts exhausted', () => {
    expect(afterEvaluate(makeState({ qualifiedListings: [], evalCount: 3, scrapeAttempts: MAX_SCRAPE_ATTEMPTS }))).toBe('summarize');
  });
});

describe('afterRender', () => {
  it('loops to scrape when under all caps and target not met', () => {
    expect(afterRender(makeState({
      qualifiedCount: 0,
      evalCount: 3,
      scrapeAttempts: 1,
    }))).toBe('dispatchScrapes');
  });

  it('summarizes when qualified target met', () => {
    expect(afterRender(makeState({
      qualifiedCount: MIN_QUALIFIED_TARGET,
      evalCount: 3,
      scrapeAttempts: 2,
    }))).toBe('summarize');
  });

  it('summarizes when eval cap hit', () => {
    expect(afterRender(makeState({
      qualifiedCount: 0,
      evalCount: 10,
      scrapeAttempts: 1,
    }))).toBe('summarize');
  });

  it('summarizes when scrape attempts exhausted', () => {
    expect(afterRender(makeState({
      qualifiedCount: 0,
      evalCount: 3,
      scrapeAttempts: MAX_SCRAPE_ATTEMPTS,
    }))).toBe('summarize');
  });
});

describe('afterTriage', () => {
  it('routes to enrich when candidates passed', () => {
    expect(afterTriage(makeState({ passedTriage: [{} as any], evalCount: 0 }))).toBe('enrich');
  });

  it('retries scrape when nothing passed and attempts remain', () => {
    expect(afterTriage(makeState({ passedTriage: [], scrapeAttempts: 1 }))).toBe('dispatchScrapes');
  });

  it('summarizes when nothing passed and scrape exhausted', () => {
    expect(afterTriage(makeState({ passedTriage: [], scrapeAttempts: MAX_SCRAPE_ATTEMPTS }))).toBe('summarize');
  });

  it('summarizes when eval cap already hit', () => {
    expect(afterTriage(makeState({ passedTriage: [{} as any], evalCount: 10 }))).toBe('summarize');
  });
});

describe('afterReconcile', () => {
  it('routes to evaluate when passed triage has items', () => {
    expect(afterReconcile(makeState({ passedTriage: [{} as any] }))).toBe('evaluate');
  });

  it('summarizes when passed triage is empty', () => {
    expect(afterReconcile(makeState({ passedTriage: [] }))).toBe('summarize');
  });
});

describe('afterPlanOptions', () => {
  it('routes to render when listings have options and FAL_KEY set', () => {
    process.env.FAL_KEY = 'test';
    expect(afterPlanOptions(makeState({ listingsWithOptions: [{} as any], conceptsRendered: 0 }))).toBe('render');
    delete process.env.FAL_KEY;
  });

  it('loops to scrape when no FAL_KEY and under target', () => {
    delete process.env.FAL_KEY;
    expect(afterPlanOptions(makeState({ listingsWithOptions: [{} as any], qualifiedCount: 0, evalCount: 3, scrapeAttempts: 1 }))).toBe('dispatchScrapes');
  });

  it('summarizes when no FAL_KEY and target met', () => {
    delete process.env.FAL_KEY;
    expect(afterPlanOptions(makeState({ listingsWithOptions: [{} as any], qualifiedCount: MIN_QUALIFIED_TARGET, evalCount: 3, scrapeAttempts: 1 }))).toBe('summarize');
  });

  it('summarizes when render cap hit', () => {
    process.env.FAL_KEY = 'test';
    expect(afterPlanOptions(makeState({ listingsWithOptions: [{} as any], conceptsRendered: 5, qualifiedCount: MIN_QUALIFIED_TARGET }))).toBe('summarize');
    delete process.env.FAL_KEY;
  });

  it('summarizes when no listings with options and target met', () => {
    expect(afterPlanOptions(makeState({ listingsWithOptions: [], qualifiedCount: MIN_QUALIFIED_TARGET }))).toBe('summarize');
  });

  it('loops to scrape when no listings with options and under target', () => {
    expect(afterPlanOptions(makeState({ listingsWithOptions: [], qualifiedCount: 0, evalCount: 3, scrapeAttempts: 1 }))).toBe('dispatchScrapes');
  });
});
