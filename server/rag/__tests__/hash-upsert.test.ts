import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// Track queries
const queries: { text: string; params: unknown[] }[] = [];
let insertReturnsId = true;

const mockClient = {
  query: vi.fn(async (text: string, params?: unknown[]) => {
    queries.push({ text, params: params ?? [] });
    if (text.includes('INSERT INTO knowledge_chunks')) {
      return { rows: insertReturnsId ? [{ id: 1 }] : [] };
    }
    if (text.includes('INSERT INTO knowledge_vec')) {
      return { rows: [] };
    }
    if (text.includes('CREATE')) {
      return { rows: [] };
    }
    if (text.includes('ALTER')) {
      return { rows: [] };
    }
    if (text.includes('SELECT COUNT')) {
      return { rows: [{ count: '0' }] };
    }
    return { rows: [] };
  }),
  release: vi.fn(),
};

vi.mock('../../db/index.js', () => ({
  pool: {
    query: (text: string, params?: unknown[]) => mockClient.query(text, params),
    connect: () => Promise.resolve(mockClient),
  },
}));

vi.mock('pgvector', () => ({
  default: { toSql: (arr: number[]) => `[${arr.join(',')}]` },
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { upsertChunk, initStore } from '../store.js';

beforeEach(() => {
  queries.length = 0;
  insertReturnsId = true;
  vi.clearAllMocks();
});

describe('hash-based upsert', () => {
  it('computes content hash and includes it in INSERT', async () => {
    // Need to call initStore first since it checks the flag
    await initStore();

    const chunk = {
      type: 'guide' as const,
      source: 'https://example.com/guide',
      title: 'Test Guide',
      content: 'How to refinish oak furniture',
      metadata: { tags: ['oak'] },
    };
    const embedding = new Float32Array([0.1, 0.2, 0.3]);
    const expectedHash = createHash('sha256').update(chunk.content).digest('hex');

    await upsertChunk(chunk, embedding);

    // Find the INSERT query
    const insertQuery = queries.find((q) => q.text.includes('INSERT INTO knowledge_chunks'));
    expect(insertQuery).toBeDefined();

    // Verify content_hash is in the query
    expect(insertQuery!.text).toContain('content_hash');
    expect(insertQuery!.text).toContain('IS DISTINCT FROM');

    // Verify the hash value is passed as a parameter
    expect(insertQuery!.params).toContain(expectedHash);
  });

  it('upserts embedding with ON CONFLICT DO UPDATE', async () => {
    const chunk = {
      type: 'product' as const,
      source: 'https://example.com/product',
      title: 'Test Product',
      content: 'Minwax stain',
      metadata: {},
    };
    const embedding = new Float32Array([0.4, 0.5, 0.6]);

    await upsertChunk(chunk, embedding);

    const vecQuery = queries.find((q) => q.text.includes('INSERT INTO knowledge_vec'));
    expect(vecQuery).toBeDefined();
    expect(vecQuery!.text).toContain('ON CONFLICT');
    expect(vecQuery!.text).toContain('DO UPDATE');
  });

  it('returns null when content unchanged (no rows returned)', async () => {
    insertReturnsId = false;

    const chunk = {
      type: 'guide' as const,
      source: 'https://example.com',
      title: 'Existing',
      content: 'Same content',
      metadata: {},
    };

    const result = await upsertChunk(chunk, new Float32Array([0.1]));
    expect(result).toBeNull();

    // Should NOT insert into knowledge_vec since content didn't change
    const vecQuery = queries.find((q) => q.text.includes('INSERT INTO knowledge_vec'));
    expect(vecQuery).toBeUndefined();
  });
});
