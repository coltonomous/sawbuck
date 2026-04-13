import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// Track queries
const queries: { text: string; params: unknown[] }[] = [];
let insertReturnsId = true;

const mockClient = {
  query: vi.fn(async (text: string, params?: unknown[]) => {
    queries.push({ text, params: params ?? [] });
    if (text.includes('INSERT INTO knowledge_chunks')) {
      return { rows: insertReturnsId ? [{ id: 1 }] : [], rowCount: insertReturnsId ? 1 : 0 };
    }
    if (text.includes('CREATE') || text.includes('ALTER') || text.includes('UPDATE knowledge_chunks')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT 1 FROM information_schema')) {
      return { rows: [] }; // no legacy table
    }
    if (text.includes('SELECT COUNT')) {
      return { rows: [{ count: '0' }] };
    }
    if (text.includes('DROP TABLE')) {
      return { rows: [] };
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

describe('hash-based upsert (single-table)', () => {
  it('inserts content, metadata, content_hash, AND embedding in one statement', async () => {
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

    // All fields in one INSERT — no separate knowledge_vec insert
    expect(insertQuery!.text).toContain('content_hash');
    expect(insertQuery!.text).toContain('embedding');
    expect(insertQuery!.text).toContain('IS DISTINCT FROM');
    expect(insertQuery!.params).toContain(expectedHash);

    // No separate INSERT into knowledge_vec — embedding is in the same INSERT
    const vecInsert = queries.find((q) => q.text.includes('INSERT') && q.text.includes('knowledge_vec'));
    expect(vecInsert).toBeUndefined();
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
  });
});
