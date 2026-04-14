import { describe, it, expect } from 'vitest';
import { agentConfig } from '../config.js';
import { MAX_SCRAPE_ATTEMPTS } from '../graph.js';
import type { AgentState } from '../state.js';

// Mirror conditional edge logic from graph.ts
function afterTriage(state: AgentState): 'enrich' | 'dispatchScrapes' | 'summarize' {
  if (state.passedTriage.length > 0) {
    if (Object.values(state.evalCount).length > 0 && Object.values(state.evalCount).every((c) => c >= agentConfig.maxEvals)) return 'summarize';
    return 'enrich';
  }
  if (Object.values(state.scrapeAttempts).length === 0 || Object.values(state.scrapeAttempts).some((a) => a < MAX_SCRAPE_ATTEMPTS)) return 'dispatchScrapes';
  return 'summarize';
}

function afterEvaluate(state: AgentState): 'discoverKnowledge' | 'summarize' {
  if (state.qualifiedListings.length === 0) return 'summarize';
  return 'discoverKnowledge';
}

function afterPlanOptions(state: AgentState): 'summarize' {
  return 'summarize';
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
    triageCount: {},
    evalCount: {},
    qualifiedCount: 0,
    conceptsRendered: 0,
    scrapeAttempts: {},
    removedIds: [],
    reconciledCount: 0,
    seenExternalIds: [],
    scrapeTask: null,
    errors: [],
    summary: null,
    ...overrides,
  };
}

const mockTriaged = { externalId: '1', platform: 'craigslist', url: '', title: 'test', askingPrice: null, location: '', imageUrls: [], triageResult: { isWoodFurniture: true, hasFlipPotential: true, furnitureType: 'table', reasoning: '', confidenceScore: 0.9 } };
const mockEvaluated = { ...mockTriaged, listingId: 1, evaluation: { furnitureType: 'table', furnitureStyle: 'modern', conditionScore: 7, woodSpecies: 'oak', estimatedValue: 200, dealScore: 2, flipRecommendation: 'buy' as const, refinishingPotential: 'high' as const, profitVerdict: 'good' } };
const mockWithOptions = { ...mockEvaluated, options: [{ difficulty: 'simple' as const, label: 'Clean', summary: 'test', estimatedHours: 2, estimatedMaterialCost: 30, estimatedResalePrice: 200 }] };

describe('afterTriage', () => {
  it('routes to enrich when candidates passed', () => {
    expect(afterTriage(makeState({ passedTriage: [mockTriaged] }))).toBe('enrich');
  });

  it('routes to summarize when eval cap reached', () => {
    expect(afterTriage(makeState({ passedTriage: [mockTriaged], evalCount: { craigslist: agentConfig.maxEvals } }))).toBe('summarize');
  });

  it('retries scrape when 0 passed and attempts remain', () => {
    expect(afterTriage(makeState({ passedTriage: [], scrapeAttempts: { craigslist: 1 } }))).toBe('dispatchScrapes');
  });

  it('summarizes when 0 passed and max attempts', () => {
    expect(afterTriage(makeState({ passedTriage: [], scrapeAttempts: { craigslist: MAX_SCRAPE_ATTEMPTS } }))).toBe('summarize');
  });
});


describe('afterEvaluate', () => {
  it('routes to discoverKnowledge when qualified listings exist', () => {
    expect(afterEvaluate(makeState({ qualifiedListings: [mockEvaluated] }))).toBe('discoverKnowledge');
  });

  it('routes to summarize when no qualified listings', () => {
    expect(afterEvaluate(makeState({ qualifiedListings: [] }))).toBe('summarize');
  });
});

describe('afterPlanOptions', () => {
  it('always summarizes (plans + renders handled internally by planOptions node)', () => {
    expect(afterPlanOptions(makeState({ listingsWithOptions: [mockWithOptions] }))).toBe('summarize');
  });
});
