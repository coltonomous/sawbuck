import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external services
vi.mock('../../lib/bedrock.js', () => ({
  analyzeWithVisionStructured: vi.fn(),
}));

vi.mock('../../rag/retrieval.js', () => ({
  isAvailable: () => false,
  getProjectContext: vi.fn(),
}));

vi.mock('../../images/downloader.js', () => ({
  downloadListingImages: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../images/processor.js', () => ({
  processListingImages: vi.fn().mockResolvedValue(undefined),
  getImageBase64: vi.fn(),
}));

vi.mock('../../analysis/vision.js', () => ({
  analyzeListing: vi.fn(),
}));

vi.mock('../../analysis/pricing.js', () => ({
  calculatePricing: vi.fn(),
}));

vi.mock('@fal-ai/client', () => ({
  fal: { subscribe: vi.fn() },
}));

import { analyzeWithVisionStructured } from '../../lib/bedrock.js';
import { analyzeListing } from '../../analysis/vision.js';
import { calculatePricing } from '../../analysis/pricing.js';
import { scrapeCategory } from '../nodes/scrape.js';
import { triageCandidates } from '../nodes/triage.js';
import { evaluateCandidates } from '../nodes/evaluate.js';
import { summarizeRun } from '../nodes/summarize.js';
import type { AgentState, ScrapedCandidate, TriagedCandidate } from '../state.js';
import { db } from '../../db/index.js';
import { listings, agentRuns, listingImages } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

const mockAnalyze = vi.mocked(analyzeWithVisionStructured);
const mockAnalyzeListing = vi.mocked(analyzeListing);
const mockCalculatePricing = vi.mocked(calculatePricing);

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    runId: `test-${Date.now()}`,
    startedAt: new Date().toISOString(),
    scrapedCandidates: [],
    triagedCandidates: [],
    passedTriage: [],
    evaluatedCandidates: [],
    qualifiedListings: [],
    listingsWithOptions: [],
    conceptRenders: [],
    triageCount: 0,
    evalCount: 0,
    qualifiedCount: 0,
    conceptsRendered: 0,
    errors: [],
    scrapeAttempts: 1,
    removedIds: [],
    reconciledCount: 0,
    seenExternalIds: [],
    summary: null,
    ...overrides,
  };
}

function makeCandidate(id: string, title: string): ScrapedCandidate {
  return {
    externalId: `agent-test-${id}-${Date.now()}`,
    url: `https://seattle.craigslist.org/test/${id}.html`,
    title,
    askingPrice: 75,
    location: 'Seattle',
    imageUrls: ['https://example.com/img1.jpg'],
    description: 'A nice piece of furniture',
  };
}

function makeTriaged(candidate: ScrapedCandidate): TriagedCandidate {
  return {
    ...candidate,
    triageResult: {
      isWoodFurniture: true,
      hasFlipPotential: true,
      furnitureType: 'dresser',
      reasoning: 'Solid wood dresser at good price',
      confidenceScore: 0.9,
    },
  };
}

describe('Agent Pipeline Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('triageCandidates → evaluateCandidates flow', () => {
    it('triages candidates and passes wood furniture to evaluation', async () => {
      const candidates = [
        makeCandidate('1', 'Solid oak dresser'),
        makeCandidate('2', 'Samsung washer'),
      ];

      // Mock triage response (batch format — both candidates in one call)
      mockAnalyze.mockResolvedValueOnce({
        assessments: [
          { id: candidates[0].externalId, is_wood_furniture: true, has_flip_potential: true, furniture_type: 'dresser', reasoning: 'Oak dresser, good flip', confidence_score: 0.9 },
          { id: candidates[1].externalId, is_wood_furniture: false, has_flip_potential: false, furniture_type: 'appliance', reasoning: 'Not furniture', confidence_score: 0.95 },
        ],
      });

      const triageResult = await triageCandidates(makeState({ scrapedCandidates: candidates }));

      expect(triageResult.triagedCandidates).toHaveLength(2);
      expect(triageResult.passedTriage).toHaveLength(1);
      expect(triageResult.passedTriage![0].title).toBe('Solid oak dresser');
    });
  });

  describe('evaluateCandidates', () => {
    it('inserts listings into DB with userId = null and triageSource = agent_eval', async () => {
      const candidate = makeTriaged(makeCandidate('eval-1', 'Walnut desk'));

      mockAnalyzeListing.mockResolvedValueOnce({
        furniture_type: 'desk',
        furniture_style: 'mid-century modern',
        condition_score: 7,
        condition_notes: 'Good condition',
        wood_species: 'walnut',
        wood_confidence: 0.85,
        notable_features: ['dovetail joints'],
        damage_items: ['minor scratches'],
        refinishing_potential: 'high',
        flip_recommendation: 'buy',
        refinishing_profit_verdict: 'Good flip potential',
      });

      mockCalculatePricing.mockResolvedValueOnce({
        estimatedValue: 250,
        estimatedRefinishedValue: 400,
        dealScore: 3.3,
        comparableCount: 5,
        medianCompPrice: 230,
        conditionMultiplier: 1.0,
        soldCount: 4,
        activeCount: 3,
      });

      const state = makeState({
        passedTriage: [candidate],
        runId: `eval-test-${Date.now()}`,
      });

      const result = await evaluateCandidates(state);

      expect(result.evaluatedCandidates).toHaveLength(1);

      // Verify DB insertion
      const dbListing = await db.select().from(listings)
        .where(eq(listings.externalId, candidate.externalId)).then(r => r[0]);

      expect(dbListing).toBeDefined();
      expect(dbListing!.userId).toBeNull();
      expect(dbListing!.triageSource).toBe('agent_eval');
      expect(dbListing!.agentRunId).toBe(state.runId);

      // Cleanup
      await db.delete(listingImages).where(eq(listingImages.listingId, dbListing!.id));
      await db.delete(listings).where(eq(listings.id, dbListing!.id));
    });
  });

  describe('summarizeRun', () => {
    it('writes agent run record to DB', async () => {
      const runId = `summary-test-${Date.now()}`;
      const state = makeState({
        runId,
        scrapedCandidates: [makeCandidate('1', 'Table')],
        triagedCandidates: [],
        passedTriage: [],
        evaluatedCandidates: [],
        qualifiedListings: [],
    listingsWithOptions: [],
        conceptRenders: [],
        errors: [],
      });

      const result = await summarizeRun(state);

      expect(result.summary).toBeDefined();
      expect(result.summary!.scraped).toBe(1);

      // Verify DB record
      const dbRun = await db.select().from(agentRuns)
        .where(eq(agentRuns.runId, runId)).then(r => r[0]);

      expect(dbRun).toBeDefined();
      expect(dbRun!.status).toBe('completed');
      expect(dbRun!.scraped).toBe(1);

      // Cleanup
      await db.delete(agentRuns).where(eq(agentRuns.runId, runId));
    });

    it('marks run as failed when all evaluations fail', async () => {
      const runId = `fail-test-${Date.now()}`;
      const state = makeState({
        runId,
        errors: [{ node: 'evaluate', message: 'All failed', timestamp: new Date().toISOString() }],
      });

      await summarizeRun(state);

      const dbRun = await db.select().from(agentRuns)
        .where(eq(agentRuns.runId, runId)).then(r => r[0]);

      expect(dbRun!.status).toBe('failed');
      expect(dbRun!.errorsCount).toBe(1);

      await db.delete(agentRuns).where(eq(agentRuns.runId, runId));
    });
  });
});
