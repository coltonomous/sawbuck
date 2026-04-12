/**
 * Tests for the RAG vector store (pgvector backed).
 *
 * Requires a running Postgres instance with pgvector extension.
 * Uses DATABASE_URL from vitest.config.ts env.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initStore, upsertChunk, upsertChunks, search, chunkCount, clearChunks } from './store.js';
import { DIMENSIONS } from './embeddings.js';

function randomEmbedding(): Float32Array {
  const arr = new Float32Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    arr[i] = Math.random() * 2 - 1;
  }
  return arr;
}

describe('RAG store (pgvector)', () => {
  beforeAll(async () => {
    await initStore();
    await clearChunks('project');
    await clearChunks('product');
    await clearChunks('guide');
  });

  afterAll(async () => {
    await clearChunks('project');
    await clearChunks('product');
    await clearChunks('guide');
  });

  it('inserts a chunk and retrieves it via search', async () => {
    const embedding = randomEmbedding();
    const id = await upsertChunk(
      { type: 'project', source: 'test', title: 'Oak Dresser Flip', content: 'Bought for $50, sold for $300', metadata: { roi: 500 } },
      embedding,
    );
    expect(id).not.toBeNull();

    const results = await search(embedding, 1, 'project');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe('Oak Dresser Flip');
  });

  it('skips duplicates on upsert', async () => {
    const embedding = randomEmbedding();
    const id1 = await upsertChunk(
      { type: 'project', source: 'test', title: 'Duplicate Test', content: 'First', metadata: {} },
      embedding,
    );
    const id2 = await upsertChunk(
      { type: 'project', source: 'test', title: 'Duplicate Test', content: 'Second', metadata: {} },
      embedding,
    );
    expect(id1).not.toBeNull();
    expect(id2).toBeNull();
  });

  it('counts chunks by type', async () => {
    const count = await chunkCount('project');
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('batch inserts chunks', async () => {
    const chunks = [
      { type: 'product' as const, source: 'test', title: 'Product A', content: 'A', metadata: {} },
      { type: 'product' as const, source: 'test', title: 'Product B', content: 'B', metadata: {} },
    ];
    const inserted = await upsertChunks(chunks, [randomEmbedding(), randomEmbedding()]);
    expect(inserted).toBe(2);
  });

  it('filters search by type', async () => {
    const results = await search(randomEmbedding(), 10, 'product');
    expect(results.every(r => r.type === 'product')).toBe(true);
  });

  it('clears chunks by type', async () => {
    const deleted = await clearChunks('product');
    expect(deleted).toBe(2);
    expect(await chunkCount('product')).toBe(0);
    expect(await chunkCount('project')).toBeGreaterThanOrEqual(1);
  });
});
