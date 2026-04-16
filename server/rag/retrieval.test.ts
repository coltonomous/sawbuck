/**
 * Tests for the RAG retrieval layer.
 *
 * Mocks the embeddings module (no model download needed) and the store
 * module (no real DB needed) to test formatting and assembly logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult, ChunkType } from './store.js';

// Mock embeddings — return a fixed vector
vi.mock('./embeddings.js', () => ({
  embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
  DIMENSIONS: 384,
}));

// Mock store — return controlled results
const mockSearch = vi.fn<(vec: Float32Array, k: number, type?: ChunkType) => SearchResult[]>();
const mockChunkCount = vi.fn<(type?: ChunkType) => number>();

vi.mock('./store.js', () => ({
  search: (...args: [Float32Array, number, ChunkType?]) => mockSearch(...args),
  chunkCount: (...args: [ChunkType?]) => mockChunkCount(...args),
}));

// Must import AFTER mocks are set up
const { getProjectContext, getProductContext, getGuideContext, getFullContext, isAvailable } = await import('./retrieval.js');

function makeResult(overrides: Partial<SearchResult> & { type: ChunkType }): SearchResult {
  return {
    id: 1,
    source: 'test',
    title: 'Test chunk',
    content: 'Test content',
    metadata: {},
    createdAt: '2025-01-01T00:00:00Z',
    distance: 0.5,
    ...overrides,
  };
}

describe('RAG retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when knowledge base has data', async () => {
      mockChunkCount.mockResolvedValue(10);
      expect(await isAvailable()).toBe(true);
    });

    it('returns false when knowledge base is empty', async () => {
      mockChunkCount.mockResolvedValue(0);
      expect(await isAvailable()).toBe(false);
    });

    it('returns false when store throws (not initialized)', async () => {
      mockChunkCount.mockRejectedValue(new Error('no such table'));
      expect(await isAvailable()).toBe(false);
    });
  });

  describe('getProjectContext', () => {
    it('returns formatted project flip results', async () => {
      mockSearch.mockReturnValue([
        makeResult({
          type: 'project',
          title: 'mid-century modern walnut dresser flip',
          content: 'Completed flip...',
          metadata: {
            purchasePrice: 80,
            totalMaterialCost: 95,
            hoursInvested: 12,
            soldPrice: 340,
            roiPercentage: 134,
            daysToFlip: 21,
          },
          distance: 0.3,
        }),
      ]);

      const ctx = await getProjectContext('dresser', 'walnut', 'mid-century modern');
      expect(ctx.chunkCount).toBe(1);
      expect(ctx.text).toContain('$80');
      expect(ctx.text).toContain('$95');
      expect(ctx.text).toContain('12 hours');
      expect(ctx.text).toContain('$340');
      expect(ctx.text).toContain('134%');
      expect(ctx.text).toContain('21 days');
    });

    it('filters out low-relevance results (distance > 1.2)', async () => {
      mockSearch.mockReturnValue([
        makeResult({ type: 'project', distance: 0.5, title: 'close match' }),
        makeResult({ type: 'project', distance: 1.5, title: 'far match', id: 2 }),
      ]);

      const ctx = await getProjectContext('dresser');
      expect(ctx.chunkCount).toBe(1);
      expect(ctx.text).toContain('close match');
      expect(ctx.text).not.toContain('far match');
    });

    it('returns empty text when no results', async () => {
      mockSearch.mockReturnValue([]);
      const ctx = await getProjectContext('dresser');
      expect(ctx.chunkCount).toBe(0);
      expect(ctx.text).toBe('');
    });
  });

  describe('getProductContext', () => {
    it('formats product chunks as title: content', async () => {
      mockSearch.mockReturnValue([
        makeResult({
          type: 'product',
          title: 'Citristrip Stripping Gel',
          content: 'Apply thick coat, wait 30 min to 24 hrs. Low odor, indoor safe.',
          distance: 0.4,
        }),
      ]);

      const ctx = await getProductContext('dresser', 'oak', 'scratched finish');
      expect(ctx.text).toContain('**Citristrip Stripping Gel**');
      expect(ctx.text).toContain('Apply thick coat');
    });
  });

  describe('getGuideContext', () => {
    it('formats guide chunks with source', async () => {
      mockSearch.mockReturnValue([
        makeResult({
          type: 'guide',
          title: 'How to Strip Furniture',
          source: 'https://minwax.com/guides/strip',
          content: 'Step 1: Apply stripper liberally...',
          distance: 0.3,
        }),
      ]);

      const ctx = await getGuideContext('dresser', 'oak', 'needs stripping');
      expect(ctx.text).toContain('**How to Strip Furniture**');
      expect(ctx.text).toContain('minwax.com');
    });
  });

  describe('getFullContext', () => {
    it('combines all three context types', async () => {
      // Mock returns different results based on the type filter
      mockSearch.mockImplementation((_vec, _k, type) => {
        if (type === 'project') {
          return [makeResult({
            type: 'project',
            title: 'oak dresser flip',
            metadata: { purchasePrice: 50, soldPrice: 200 },
            distance: 0.3,
          })];
        }
        if (type === 'product') {
          return [makeResult({
            type: 'product',
            title: 'Minwax Stain',
            content: 'Oil-based wood stain',
            distance: 0.4,
          })];
        }
        if (type === 'guide') {
          return [makeResult({
            type: 'guide',
            title: 'Staining guide',
            source: 'https://example.com',
            content: 'How to stain...',
            distance: 0.5,
          })];
        }
        return [];
      });

      const ctx = await getFullContext({
        furnitureType: 'dresser',
        woodSpecies: 'oak',
        style: 'traditional',
        conditionNotes: 'needs refinishing',
      });

      expect(ctx.chunkCount).toBe(3);
      expect(ctx.text).toContain('REFERENCE KNOWLEDGE');
      expect(ctx.text).toContain('Past Flip Outcomes');
      expect(ctx.text).toContain('Relevant Product Specs');
      expect(ctx.text).toContain('Refinishing Techniques');
      expect(ctx.text).toContain('END REFERENCE KNOWLEDGE');
    });

    it('omits empty sections', async () => {
      mockSearch.mockImplementation((_vec, _k, type) => {
        if (type === 'project') {
          return [makeResult({
            type: 'project',
            title: 'dresser flip',
            metadata: { purchasePrice: 50 },
            distance: 0.3,
          })];
        }
        return []; // no products or guides
      });

      const ctx = await getFullContext({ furnitureType: 'dresser' });
      expect(ctx.text).toContain('Past Flip Outcomes');
      expect(ctx.text).not.toContain('Relevant Product Specs');
      expect(ctx.text).not.toContain('Refinishing Techniques');
    });

    it('returns empty string when nothing matches', async () => {
      mockSearch.mockReturnValue([]);
      const ctx = await getFullContext({ furnitureType: 'dresser' });
      expect(ctx.chunkCount).toBe(0);
      expect(ctx.text).toBe('');
    });

    it('deduplicates sources by URL, keeping the closest match', async () => {
      const sharedUrl = 'https://minwax.com/guides/staining';
      mockSearch.mockImplementation((_vec, _k, type) => {
        if (type === 'product') {
          return [
            makeResult({
              type: 'product',
              id: 1,
              title: 'Minwax Staining Guide',
              source: sharedUrl,
              content: 'Part one of the guide...',
              distance: 0.3,
            }),
            makeResult({
              type: 'product',
              id: 2,
              title: 'Minwax Staining Guide (part 2)',
              source: sharedUrl,
              content: 'Part two of the guide...',
              distance: 0.5,
            }),
          ];
        }
        if (type === 'guide') {
          return [
            makeResult({
              type: 'guide',
              id: 3,
              title: 'Minwax Staining Guide (part 3)',
              source: sharedUrl,
              content: 'Part three of the guide...',
              distance: 0.6,
            }),
          ];
        }
        return [];
      });

      const ctx = await getFullContext({
        furnitureType: 'dresser',
        woodSpecies: 'oak',
      });

      // All 3 chunks should be in results (used for prompt context)
      expect(ctx.chunkCount).toBe(3);
      // But sources should be deduplicated to 1 unique URL
      expect(ctx.sources).toHaveLength(1);
      expect(ctx.sources[0].source).toBe(sharedUrl);
      // Should keep the closest match (distance 0.3)
      expect(ctx.sources[0].distance).toBe(0.3);
    });
  });
});
