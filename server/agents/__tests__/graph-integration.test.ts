/**
 * Integration test: verifies the LangGraph pipeline compiles and the
 * dispatch → scrapeOne → merge flow actually works at the runtime level.
 *
 * This catches issues like the Send/Command API mismatch that broke
 * production — TypeScript compiles fine but LangGraph throws at runtime.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock all external dependencies so the graph can compile and run without
// a real database, Bedrock, or external HTTP calls.

vi.mock('../../db/index.js', () => ({
  db: new Proxy({}, { get: () => () => ({ then: (r: any) => r([]), catch: () => ({}) }) }),
  pool: { query: () => Promise.resolve({ rows: [], rowCount: 0 }), connect: () => Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => {} }) },
}));

vi.mock('../../db/schema.js', () => ({
  listings: {}, listingImages: {}, agentRuns: {}, conceptRenders: {},
  platformSettings: {}, regions: {}, knowledgeSources: {},
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/bedrock.js', () => ({
  analyzeWithVisionStructured: vi.fn().mockResolvedValue({ assessments: [] }),
}));

vi.mock('../../rag/retrieval.js', () => ({
  isAvailable: () => Promise.resolve(false),
  getProjectContext: () => Promise.resolve({ text: '', chunkCount: 0, results: [], sources: [] }),
  getFullContext: () => Promise.resolve({ text: '', chunkCount: 0, results: [], sources: [] }),
}));

vi.mock('../../rag/store.js', () => ({
  initStore: () => Promise.resolve(),
  search: () => Promise.resolve([]),
  chunkCount: () => Promise.resolve(0),
}));

vi.mock('../../rag/embeddings.js', () => ({
  embed: () => Promise.resolve(new Float32Array(384)),
  DIMENSIONS: 384,
}));

// Mock the registry to return a test platform + region
const mockDiscover = vi.fn().mockResolvedValue([
  { externalId: 'test-1', platform: 'craigslist', url: 'http://test/1', title: 'Oak Dresser', askingPrice: 100, location: 'Seattle', imageUrls: [] },
]);

vi.mock('../../integrations/registry.js', () => ({
  getEnabledPlatforms: () => Promise.resolve([
    { platform: 'craigslist', discover: mockDiscover, enrich: vi.fn().mockResolvedValue({ enriched: [], removedIds: [] }) },
  ]),
  getEnabledRegions: () => Promise.resolve([
    { id: 1, name: 'seattle', latitude: 47.6, longitude: -122.3, radiusMiles: 30, clSubdomain: 'seattle' },
  ]),
  getIntegration: () => ({
    platform: 'craigslist',
    discover: mockDiscover,
    enrich: vi.fn().mockResolvedValue({ enriched: [], removedIds: [] }),
  }),
}));

vi.mock('../config.js', () => ({
  agentConfig: {
    maxTriages: 50,
    maxEvals: 10,
    triageConfidenceThreshold: 0.75,
    dealScoreThreshold: 1.3,
    flipRecommendationThreshold: ['strong_buy', 'buy'],
    minDelayBetweenRequestsMs: 0,
    maxDelayBetweenRequestsMs: 0,
    dailyRequestCap: 1000,
    cronSchedule: '0 */4 * * *',
    targetCity: 'seattle',
    triageModel: 'test-model',
    evaluationModel: 'test-model',
    falModel: 'test-model',
    conceptRenderSize: 768,
  },
  refreshAgentConfig: () => Promise.resolve(),
}));

vi.mock('../progress.js', () => ({
  reportProgress: vi.fn(),
}));

// Mock LangGraph checkpointer to avoid needing Postgres
vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: {
    fromConnString: () => ({
      setup: () => Promise.resolve(),
      getTuple: () => Promise.resolve(undefined),
      list: () => [],
      put: () => Promise.resolve({}),
    }),
  },
}));

describe('Graph Integration', () => {
  it('compiles the graph without UNREACHABLE_NODE or other errors', async () => {
    // This import triggers graph.compile() at module load time.
    // If Send/Command API is wrong, it throws here.
    const { agentPipeline } = await import('../graph.js');
    expect(agentPipeline).toBeDefined();
  });

  it('dispatches scrapeOne via Command with Send goto', async () => {
    const { dispatchScrapes } = await import('../nodes/scrape.js');
    const { Command, Send } = await import('@langchain/langgraph');

    const result = await dispatchScrapes({
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
    });

    // Must return a Command (not a raw Send[])
    expect(result).toBeInstanceOf(Command);

    // The goto field should contain Send objects
    const goto = (result as any).goto;
    expect(Array.isArray(goto)).toBe(true);
    expect(goto.length).toBeGreaterThan(0);
    expect(goto[0]).toBeInstanceOf(Send);
  });
});
