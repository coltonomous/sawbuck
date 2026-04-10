import { describe, it, expect } from 'vitest';
import { agentConfig } from '../config.js';
import { MAX_SCRAPE_ATTEMPTS } from '../graph.js';
import type { AgentState } from '../state.js';

// Mirror conditional edge logic from graph.ts
function afterTriage(state: AgentState): 'enrich' | 'scrape' | 'summarize' {
  if (state.passedTriage.length > 0) {
    if (state.sonnetEvaluated >= agentConfig.maxSonnetEvals) return 'summarize';
    return 'enrich';
  }
  if (state.scrapeAttempts < MAX_SCRAPE_ATTEMPTS) return 'scrape';
  return 'summarize';
}

function afterEvaluate(state: AgentState): 'planOptions' | 'summarize' {
  if (state.qualifiedListings.length === 0) return 'summarize';
  return 'planOptions';
}

function afterPlanOptions(state: AgentState): 'render' | 'summarize' {
  if (state.listingsWithOptions.length === 0) return 'summarize';
  if (state.conceptsRendered >= agentConfig.maxListingsRendered) return 'summarize';
  if (!process.env.FAL_KEY) return 'summarize';
  return 'render';
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
    haikuTriaged: 0,
    sonnetEvaluated: 0,
    conceptsRendered: 0,
    scrapeAttempts: 0,
    errors: [],
    summary: null,
    ...overrides,
  };
}

const mockTriaged = { externalId: '1', url: '', title: 'test', askingPrice: null, location: '', imageUrls: [], triageResult: { isWoodFurniture: true, hasFlipPotential: true, furnitureType: 'table', reasoning: '', confidenceScore: 0.9 } };
const mockEvaluated = { ...mockTriaged, listingId: 1, evaluation: { furnitureType: 'table', furnitureStyle: 'modern', conditionScore: 7, woodSpecies: 'oak', estimatedValue: 200, dealScore: 2, flipRecommendation: 'buy' as const, refinishingPotential: 'high' as const, profitVerdict: 'good' } };
const mockWithOptions = { ...mockEvaluated, options: [{ difficulty: 'simple' as const, label: 'Clean', summary: 'test', estimatedHours: 2, estimatedMaterialCost: 30, estimatedResalePrice: 200 }] };

describe('afterTriage', () => {
  it('routes to enrich when candidates passed', () => {
    expect(afterTriage(makeState({ passedTriage: [mockTriaged] }))).toBe('enrich');
  });

  it('routes to summarize when sonnet cap reached', () => {
    expect(afterTriage(makeState({ passedTriage: [mockTriaged], sonnetEvaluated: agentConfig.maxSonnetEvals }))).toBe('summarize');
  });

  it('retries scrape when 0 passed and attempts remain', () => {
    expect(afterTriage(makeState({ passedTriage: [], scrapeAttempts: 1 }))).toBe('scrape');
  });

  it('summarizes when 0 passed and max attempts', () => {
    expect(afterTriage(makeState({ passedTriage: [], scrapeAttempts: MAX_SCRAPE_ATTEMPTS }))).toBe('summarize');
  });
});

describe('afterEvaluate', () => {
  it('routes to planOptions when qualified listings exist', () => {
    expect(afterEvaluate(makeState({ qualifiedListings: [mockEvaluated] }))).toBe('planOptions');
  });

  it('routes to summarize when no qualified listings', () => {
    expect(afterEvaluate(makeState({ qualifiedListings: [] }))).toBe('summarize');
  });
});

describe('afterPlanOptions', () => {
  it('routes to render when listings with options exist and FAL_KEY set', () => {
    const orig = process.env.FAL_KEY;
    process.env.FAL_KEY = 'test';
    expect(afterPlanOptions(makeState({ listingsWithOptions: [mockWithOptions] }))).toBe('render');
    if (orig) process.env.FAL_KEY = orig; else delete process.env.FAL_KEY;
  });

  it('routes to summarize when no FAL_KEY', () => {
    const orig = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    expect(afterPlanOptions(makeState({ listingsWithOptions: [mockWithOptions] }))).toBe('summarize');
    if (orig) process.env.FAL_KEY = orig;
  });

  it('routes to summarize when render cap reached', () => {
    expect(afterPlanOptions(makeState({
      listingsWithOptions: [mockWithOptions],
      conceptsRendered: agentConfig.maxListingsRendered,
    }))).toBe('summarize');
  });
});
