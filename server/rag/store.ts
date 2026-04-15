/**
 * Vector store backed by pgvector (Postgres extension).
 *
 * Uses the Drizzle-managed `knowledge_chunks` table from schema.ts.
 * Raw SQL is used only for vector similarity search (Drizzle lacks
 * native pgvector operator support).
 */

import { createHash } from 'crypto';
import { db, pool } from '../db/index.js';
import { knowledgeChunks } from '../db/schema.js';
import { eq, and, sql, asc, count as drizzleCount } from 'drizzle-orm';
import { DIMENSIONS } from './embeddings.js';
import logger from '../lib/logger.js';
import pgvector from 'pgvector';

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export type ChunkType = 'project' | 'product' | 'guide';

export interface KnowledgeChunk {
  id: number;
  type: ChunkType;
  source: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SearchResult extends KnowledgeChunk {
  distance: number;
}

let extensionReady = false;

/** Ensure pgvector extension exists. Table is managed by Drizzle. */
export async function initStore(): Promise<void> {
  if (extensionReady) return;
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  extensionReady = true;
  logger.info('RAG store initialized (pgvector extension ready)');
}

/**
 * Insert a chunk + its embedding. Updates content and embedding
 * only when the content hash changes.
 */
export async function upsertChunk(
  chunk: Omit<KnowledgeChunk, 'id' | 'createdAt'>,
  embedding: Float32Array,
): Promise<number | null> {
  await initStore();

  const hash = contentHash(chunk.content);
  const embeddingSql = pgvector.toSql(Array.from(embedding));

  // Use raw SQL for the upsert because Drizzle doesn't support
  // vector columns in onConflictDoUpdate + WHERE clause
  const result = await pool.query(
    `INSERT INTO knowledge_chunks (type, source, title, content, metadata, content_hash, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (type, source, title) DO UPDATE
       SET content = EXCLUDED.content,
           metadata = EXCLUDED.metadata,
           content_hash = EXCLUDED.content_hash,
           embedding = EXCLUDED.embedding
       WHERE knowledge_chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash
     RETURNING id`,
    [chunk.type, chunk.source, chunk.title, chunk.content, JSON.stringify(chunk.metadata), hash, embeddingSql],
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].id;
}

/**
 * Batch insert chunks + embeddings in a transaction.
 * Returns count of newly inserted/updated chunks.
 */
export async function upsertChunks(
  chunks: Omit<KnowledgeChunk, 'id' | 'createdAt'>[],
  embeddings: Float32Array[],
): Promise<number> {
  if (chunks.length !== embeddings.length) {
    throw new Error('chunks and embeddings arrays must have the same length');
  }

  await initStore();

  const client = await pool.connect();
  let inserted = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const hash = contentHash(chunk.content);
      const embeddingSql = pgvector.toSql(Array.from(embeddings[i]));

      const result = await client.query(
        `INSERT INTO knowledge_chunks (type, source, title, content, metadata, content_hash, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (type, source, title) DO UPDATE
           SET content = EXCLUDED.content,
               metadata = EXCLUDED.metadata,
               content_hash = EXCLUDED.content_hash,
               embedding = EXCLUDED.embedding
           WHERE knowledge_chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash
         RETURNING id`,
        [chunk.type, chunk.source, chunk.title, chunk.content, JSON.stringify(chunk.metadata), hash, embeddingSql],
      );

      if (result.rows.length > 0) inserted++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return inserted;
}

/**
 * Search for the k nearest chunks to a query embedding.
 * Optionally filter by chunk type.
 *
 * Uses raw SQL because Drizzle has no native pgvector operator support.
 */
export async function search(
  queryEmbedding: Float32Array,
  k = 5,
  type?: ChunkType,
): Promise<SearchResult[]> {
  await initStore();

  const embeddingSql = pgvector.toSql(Array.from(queryEmbedding));

  let query: string;
  let params: unknown[];

  if (type) {
    query = `
      SELECT id, type, source, title, content, metadata, content_hash, created_at,
             embedding <=> $1 as distance
      FROM knowledge_chunks
      WHERE type = $2 AND embedding IS NOT NULL
      ORDER BY embedding <=> $1
      LIMIT $3
    `;
    params = [embeddingSql, type, k];
  } else {
    query = `
      SELECT id, type, source, title, content, metadata, content_hash, created_at,
             embedding <=> $1 as distance
      FROM knowledge_chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1
      LIMIT $2
    `;
    params = [embeddingSql, k];
  }

  const result = await pool.query(query, params);

  // Touch last_accessed_at for LRU eviction (fire-and-forget)
  const hitIds = result.rows.map((r: { id: number }) => r.id).filter(Boolean);
  if (hitIds.length > 0) {
    db.update(knowledgeChunks)
      .set({ lastAccessedAt: new Date() })
      .where(sql`${knowledgeChunks.id} = ANY(${hitIds})`)
      .catch(() => {}); // non-fatal
  }

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as number,
    type: row.type as ChunkType,
    source: row.source as string,
    title: row.title as string,
    content: row.content as string,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: String(row.created_at),
    distance: row.distance as number,
  }));
}

/** Get total chunk count, optionally filtered by type. */
export async function chunkCount(type?: ChunkType): Promise<number> {
  await initStore();

  const conditions = type ? eq(knowledgeChunks.type, type) : undefined;
  const [result] = await db.select({ total: drizzleCount() })
    .from(knowledgeChunks)
    .where(conditions);

  return result?.total ?? 0;
}

/** Delete all chunks of a given type. */
export async function clearChunks(type: ChunkType): Promise<number> {
  await initStore();

  const result = await db.delete(knowledgeChunks)
    .where(eq(knowledgeChunks.type, type));

  return result.rowCount ?? 0;
}

/**
 * Evict the least-recently-used chunks of a given type when count exceeds maxCount.
 * Chunks that are frequently hit by searches survive; stale chunks get pruned.
 * Returns the number of chunks deleted.
 */
export async function evictExcess(type: ChunkType, maxCount: number): Promise<number> {
  await initStore();

  const total = await chunkCount(type);
  if (total <= maxCount) return 0;

  const excess = total - maxCount;
  // Use raw SQL for the subquery delete (Drizzle doesn't support DELETE ... WHERE id IN (SELECT ...))
  const result = await pool.query(
    `DELETE FROM knowledge_chunks
     WHERE id IN (
       SELECT id FROM knowledge_chunks
       WHERE type = $1
       ORDER BY last_accessed_at ASC
       LIMIT $2
     )`,
    [type, excess],
  );

  const deleted = result.rowCount ?? 0;
  if (deleted > 0) {
    logger.info({ type, deleted, total, maxCount }, 'RAG eviction: removed least-recently-used chunks');
  }
  return deleted;
}
