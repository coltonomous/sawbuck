import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock EVERY external dependency of plan-options.ts ----

vi.mock('../../lib/bedrock.js', () => ({
  analyzeWithVisionStructured: vi.fn(),
}));

vi.mock('../../rag/retrieval.js', () => ({
  isAvailable: () => Promise.resolve(false),
  getGuideContext: vi.fn(),
  getProductContext: vi.fn(),
}));

vi.mock('../../analysis/refinishing.js', () => ({
  generateRefinishingPlan: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../analysis/sourcing.js', () => ({
  generateMaterialsFromPlanSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/images.js', () => ({
  getListingImageUrlForFal: vi.fn(),
}));

vi.mock('../../lib/render-prompt.js', () => ({
  buildConceptRenderRequest: vi.fn().mockReturnValue({
    model: 'fal-ai/test',
    input: { prompt: 'fake prompt' },
  }),
}));

vi.mock('../../lib/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue(undefined),
}));

const falSubscribe = vi.fn();
vi.mock('@fal-ai/client', () => ({
  fal: { subscribe: (...args: any[]) => falSubscribe(...args) },
}));

vi.mock('sharp', () => {
  const chain = { webp: () => chain, toBuffer: () => Promise.resolve(Buffer.from('webp')) };
  return { default: () => chain };
});

// Capture DB insert payloads without a real DB.
const insertedValues: any[] = [];
const onConflictTargets: any[] = [];

vi.mock('../../db/index.js', () => ({
  db: {
    insert: () => ({
      values: (row: any) => {
        insertedValues.push(row);
        return {
          onConflictDoNothing: (opts: any) => {
            onConflictTargets.push(opts);
            return Promise.resolve();
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ then: (fn: any) => fn([]) }) }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  },
}));

// fetch for downloading the rendered image
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { analyzeWithVisionStructured } from '../../lib/bedrock.js';
import { getListingImageUrlForFal } from '../../lib/images.js';
import { uploadToS3 } from '../../lib/s3.js';
import { generatePlanOptions } from '../nodes/plan-options.js';
import type { AgentState, EvaluatedCandidate } from '../state.js';

const mockAnalyze = vi.mocked(analyzeWithVisionStructured);
const mockGetRef = vi.mocked(getListingImageUrlForFal);
const mockUpload = vi.mocked(uploadToS3);

function makeListing(listingId: number): EvaluatedCandidate {
  return {
    externalId: `ext-${listingId}`,
    platform: 'craigslist',
    url: `https://example.com/${listingId}`,
    title: 'Oak dresser',
    askingPrice: 75,
    location: 'Seattle',
    imageUrls: [],
    triageResult: {
      isWoodFurniture: true,
      hasFlipPotential: true,
      furnitureType: 'dresser',
      reasoning: '',
      confidenceScore: 0.9,
    },
    listingId,
    evaluation: {
      furnitureType: 'dresser',
      furnitureStyle: 'mid-century',
      conditionScore: 7,
      woodSpecies: 'oak',
      estimatedValue: 400,
      dealScore: 2.5,
      flipRecommendation: 'buy',
      refinishingPotential: 'high',
      profitVerdict: 'Good flip',
    },
  };
}

function makeState(listings: EvaluatedCandidate[]): AgentState {
  return {
    runId: 'run-test',
    startedAt: new Date().toISOString(),
    scrapedCandidates: [],
    triagedCandidates: [],
    passedTriage: [],
    evaluatedCandidates: [],
    qualifiedListings: listings,
    listingsWithOptions: [],
    conceptRenders: [],
    triageCount: {},
    evalCount: {},
    qualifiedCount: listings.length,
    conceptsRendered: 0,
    scrapeAttempts: {},
    removedIds: [],
    reconciledCount: 0,
    seenExternalIds: [],
    scrapeTask: null,
    errors: [],
    summary: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedValues.length = 0;
  onConflictTargets.length = 0;
  delete process.env.FAL_KEY;
});

describe('generatePlanOptions — concept_index persistence', () => {
  it('assigns conceptIndex 0,1,2 across three concepts even when finishType collides', async () => {
    // Two of three concepts share finishType=stain. Pre-fix, the second stain
    // would collide with the first on the (listing_id, finish_type) unique
    // index and get silently dropped.
    mockAnalyze.mockResolvedValueOnce({
      concepts: [
        { finishType: 'stain', label: 'Dark Walnut Stain', summary: 'rich brown' },
        { finishType: 'stain', label: 'Golden Oak Stain', summary: 'warm amber' },
        { finishType: 'paint', label: 'Chalk White', summary: 'farmhouse' },
      ],
    });

    await generatePlanOptions(makeState([makeListing(100)]));

    // Three rows inserted — none dropped.
    const rowsForListing = insertedValues.filter((v) => v.listingId === 100);
    expect(rowsForListing).toHaveLength(3);

    // conceptIndex is 0,1,2 in order.
    expect(rowsForListing.map((r) => r.conceptIndex)).toEqual([0, 1, 2]);

    // Both "stain" entries survive — they differ only by conceptIndex.
    const stainRows = rowsForListing.filter((r) => r.finishType === 'stain');
    expect(stainRows).toHaveLength(2);
    expect(stainRows.map((r) => r.label).sort()).toEqual(['Dark Walnut Stain', 'Golden Oak Stain']);
  });

  it('onConflictDoNothing targets (listingId, conceptIndex) — not finishType', async () => {
    mockAnalyze.mockResolvedValueOnce({
      concepts: [
        { finishType: 'stain', label: 'A', summary: '' },
        { finishType: 'stain', label: 'B', summary: '' },
      ],
    });

    await generatePlanOptions(makeState([makeListing(200)]));

    // Inspect the shape of the conflict target — it must include conceptIndex.
    expect(onConflictTargets.length).toBeGreaterThan(0);
    for (const opts of onConflictTargets) {
      const targetCols: any[] = opts.target;
      // target is a list of drizzle column objects; we check by column name on `.name`
      // (drizzle columns expose `.name`).
      const names = targetCols.map((c: any) => c.name);
      expect(names).toContain('concept_index');
      expect(names).toContain('listing_id');
      expect(names).not.toContain('finish_type');
    }
  });

  it('persists agentRunId, label, summary, finishType for every slot', async () => {
    mockAnalyze.mockResolvedValueOnce({
      concepts: [
        { finishType: 'stain', label: 'Dark Walnut Stain', summary: 'rich brown' },
        { finishType: 'paint', label: 'Chalk White', summary: 'farmhouse' },
      ],
    });

    await generatePlanOptions(makeState([makeListing(300)]));

    const rows = insertedValues.filter((v) => v.listingId === 300);
    expect(rows[0]).toMatchObject({
      agentRunId: 'run-test',
      conceptIndex: 0,
      finishType: 'stain',
      label: 'Dark Walnut Stain',
      summary: 'rich brown',
    });
    expect(rows[1]).toMatchObject({
      agentRunId: 'run-test',
      conceptIndex: 1,
      finishType: 'paint',
      label: 'Chalk White',
      summary: 'farmhouse',
    });
  });

  it('leaves renderedImageUrl null when FAL_KEY is not set — row still persists', async () => {
    // FAL_KEY unset in beforeEach
    mockAnalyze.mockResolvedValueOnce({
      concepts: [{ finishType: 'oil', label: 'Tung Oil', summary: '' }],
    });

    await generatePlanOptions(makeState([makeListing(400)]));

    const rows = insertedValues.filter((v) => v.listingId === 400);
    expect(rows).toHaveLength(1);
    expect(rows[0].renderedImageUrl).toBeNull();
    expect(rows[0].localPath).toBeNull();
    expect(falSubscribe).not.toHaveBeenCalled();
  });
});

describe('generatePlanOptions — S3 upload behavior', () => {
  it('encodes listingId, conceptIndex, and finishType into distinct S3 keys (so same-finish concepts do not collide)', async () => {
    process.env.FAL_KEY = 'test-key';
    mockGetRef.mockResolvedValueOnce('https://cdn.example.com/ref.jpg');

    mockAnalyze.mockResolvedValueOnce({
      concepts: [
        { finishType: 'stain', label: 'Dark', summary: '' },
        { finishType: 'stain', label: 'Light', summary: '' },
      ],
    });

    // fal returns an image URL for each concept
    falSubscribe.mockResolvedValue({
      data: { images: [{ url: 'https://fal.example.com/out.jpg' }] },
    });
    fetchMock.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(8),
    });

    await generatePlanOptions(makeState([makeListing(500)]));

    // uploadToS3(key, buffer, mimeType) — extract keys
    const keys = mockUpload.mock.calls.map((args) => args[0] as string);
    expect(keys).toHaveLength(2);
    // Both stain, but different indices → different keys
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toBe('concepts/500_0_stain.webp');
    expect(keys[1]).toBe('concepts/500_1_stain.webp');
  });

  it('falls back gracefully when FAL times out — row still persists with null render url', async () => {
    process.env.FAL_KEY = 'test-key';
    mockGetRef.mockResolvedValueOnce('https://cdn.example.com/ref.jpg');

    mockAnalyze.mockResolvedValueOnce({
      concepts: [{ finishType: 'paint', label: 'White', summary: '' }],
    });

    // fal never resolves — simulate a hang. Plan-options' own timeout (120s) is
    // what we'd rely on in prod, but in a test we want a fast failure, so make
    // fal.subscribe itself reject.
    falSubscribe.mockRejectedValue(new Error('Render timed out after 120s'));

    await generatePlanOptions(makeState([makeListing(600)]));

    const rows = insertedValues.filter((v) => v.listingId === 600);
    expect(rows).toHaveLength(1);
    expect(rows[0].renderedImageUrl).toBeNull();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('processes multiple listings independently — each gets its own slot indices starting at 0', async () => {
    mockAnalyze
      .mockResolvedValueOnce({
        concepts: [
          { finishType: 'stain', label: 'A', summary: '' },
          { finishType: 'paint', label: 'B', summary: '' },
        ],
      })
      .mockResolvedValueOnce({
        concepts: [
          { finishType: 'oil', label: 'C', summary: '' },
          { finishType: 'wax', label: 'D', summary: '' },
          { finishType: 'lacquer', label: 'E', summary: '' },
        ],
      });

    await generatePlanOptions(makeState([makeListing(700), makeListing(800)]));

    const rows700 = insertedValues.filter((v) => v.listingId === 700);
    const rows800 = insertedValues.filter((v) => v.listingId === 800);
    expect(rows700.map((r) => r.conceptIndex)).toEqual([0, 1]);
    expect(rows800.map((r) => r.conceptIndex)).toEqual([0, 1, 2]);
  });
});
