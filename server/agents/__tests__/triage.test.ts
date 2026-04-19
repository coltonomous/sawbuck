import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriageSchema } from '../nodes/triage.js';

// Mock the bedrock module
vi.mock('../../lib/bedrock.js', () => ({
  analyzeWithVisionStructured: vi.fn(),
}));

// Mock RAG
vi.mock('../../rag/retrieval.js', () => ({
  isAvailable: () => false,
  getProjectContext: vi.fn(),
}));

import { analyzeWithVisionStructured } from '../../lib/bedrock.js';
import { triageCandidates } from '../nodes/triage.js';
import type { AgentState, ScrapedCandidate } from '../state.js';

const mockAnalyze = vi.mocked(analyzeWithVisionStructured);

function makeCandidate(overrides: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return {
    externalId: `test-${Math.random().toString(36).slice(2)}`,
    platform: 'craigslist',
    url: 'https://seattle.craigslist.org/test/1.html',
    title: 'Test item',
    askingPrice: 50,
    location: 'Seattle',
    imageUrls: [],
    ...overrides,
  };
}

function makeState(candidates: ScrapedCandidate[], overrides: Partial<AgentState> = {}): AgentState {
  return {
    runId: 'test-run',
    startedAt: new Date().toISOString(),
    scrapedCandidates: candidates,
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
    scrapeAttempts: { craigslist: 1 },
    removedIds: [],
    reconciledCount: 0,
    seenExternalIds: [],
    scrapeTask: null,
    errors: [],
    summary: null,
    ...overrides,
  };
}

// Helper to create batch response matching the candidates
function makeBatchResponse(assessments: Array<{ id: string; wood: boolean; flip: boolean; confidence: number; type?: string }>) {
  return {
    assessments: assessments.map((a) => ({
      id: a.id,
      is_wood_furniture: a.wood,
      has_flip_potential: a.flip,
      furniture_type: a.type || 'unknown',
      reasoning: 'test',
      confidence_score: a.confidence,
    })),
  };
}

describe('triageCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes wood furniture listings', async () => {
    const candidate = makeCandidate({ title: 'Solid oak dresser - $50' });
    mockAnalyze.mockResolvedValueOnce(makeBatchResponse([
      { id: candidate.externalId, wood: true, flip: true, confidence: 0.9, type: 'dresser' },
    ]));

    const result = await triageCandidates(makeState([candidate]));

    expect(result.passedTriage).toHaveLength(1);
    expect(result.triagedCandidates).toHaveLength(1);
    expect(result.passedTriage![0].triageResult.isWoodFurniture).toBe(true);
  });

  it('pre-filters obvious non-furniture before LLM', async () => {
    const candidate = makeCandidate({ title: 'Samsung washer dryer combo' });

    const result = await triageCandidates(makeState([candidate]));

    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(result.passedTriage).toHaveLength(0);
    expect(result.triagedCandidates).toHaveLength(0);
  });

  it('rejects non-furniture items via LLM', async () => {
    const candidate = makeCandidate({ title: 'Decorative wall piece' });
    mockAnalyze.mockResolvedValueOnce(makeBatchResponse([
      { id: candidate.externalId, wood: false, flip: false, confidence: 0.95 },
    ]));

    const result = await triageCandidates(makeState([candidate]));

    expect(result.passedTriage).toHaveLength(0);
    expect(result.triagedCandidates).toHaveLength(1);
  });

  it('rejects non-wood furniture', async () => {
    const candidate = makeCandidate({ title: 'Glass coffee table with metal legs' });
    mockAnalyze.mockResolvedValueOnce(makeBatchResponse([
      { id: candidate.externalId, wood: false, flip: false, confidence: 0.85 },
    ]));

    const result = await triageCandidates(makeState([candidate]));
    expect(result.passedTriage).toHaveLength(0);
  });

  it('rejects low confidence results', async () => {
    const candidate = makeCandidate({ title: 'Old cabinet thing' });
    mockAnalyze.mockResolvedValueOnce(makeBatchResponse([
      { id: candidate.externalId, wood: true, flip: true, confidence: 0.4 },
    ]));

    const result = await triageCandidates(makeState([candidate]));
    expect(result.passedTriage).toHaveLength(0);
    expect(result.triagedCandidates).toHaveLength(1);
  });

  it('batches listings to reduce API calls', async () => {
    // 10 candidates = 1 batch of 10 (BATCH_SIZE=10)
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate({ externalId: `batch-${i}`, title: `Item ${i}` }),
    );

    mockAnalyze
      .mockResolvedValueOnce(makeBatchResponse(
        candidates.map((c) => ({ id: c.externalId, wood: true, flip: true, confidence: 0.8 })),
      ));

    const result = await triageCandidates(makeState(candidates));

    expect(mockAnalyze).toHaveBeenCalledTimes(1); // 1 batch of 10
    expect(result.triagedCandidates).toHaveLength(10);
    expect(result.passedTriage).toHaveLength(10);
  });

  it('respects the max cap', async () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ externalId: `cap-${i}`, title: `Item ${i}` }),
    );

    mockAnalyze.mockResolvedValueOnce(makeBatchResponse(
      candidates.slice(0, 2).map((c) => ({ id: c.externalId, wood: true, flip: true, confidence: 0.8 })),
    ));

    // Already triaged 48 for craigslist, cap is 50, so only 2 should be processed
    const result = await triageCandidates(makeState(candidates, { triageCount: { craigslist: 48 } }));

    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(result.triageCount).toEqual({ craigslist: 50 });
  });

  it('handles batch errors gracefully', async () => {
    // 20 candidates = 2 batches of 10 + 10
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate({ externalId: `err-${i}`, title: `Item ${i}` }),
    );

    mockAnalyze
      .mockResolvedValueOnce(makeBatchResponse(
        candidates.slice(0, 10).map((c) => ({ id: c.externalId, wood: true, flip: true, confidence: 0.8 })),
      ))
      .mockRejectedValueOnce(new Error('API error'));

    const result = await triageCandidates(makeState(candidates));

    expect(result.triagedCandidates).toHaveLength(10); // first batch succeeded
    expect(result.errors).toHaveLength(1); // second batch failed
    expect(result.triageCount).toEqual({ craigslist: 10 });
  });
});

describe('TriageSchema', () => {
  it('validates correct triage output', () => {
    const valid = {
      is_wood_furniture: true,
      has_flip_potential: true,
      furniture_type: 'dresser',
      reasoning: 'Solid oak at good price',
      confidence_score: 0.85,
    };
    expect(TriageSchema.parse(valid)).toEqual(valid);
  });

  it('fills defaults for missing fields', () => {
    const result = TriageSchema.parse({ is_wood_furniture: true });
    expect(result.has_flip_potential).toBe(false);
    expect(result.furniture_type).toBe('unknown');
    expect(result.reasoning).toBe('');
    expect(result.confidence_score).toBe(0);
  });

  it('rejects confidence out of range', () => {
    expect(() =>
      TriageSchema.parse({
        is_wood_furniture: true,
        has_flip_potential: true,
        furniture_type: 'table',
        reasoning: 'test',
        confidence_score: 1.5,
      }),
    ).toThrow();
  });
});
