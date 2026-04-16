/**
 * Vector store backed by pgvector (Postgres extension).
 *
 * Single table: knowledge_chunks stores content, metadata, AND the
 * embedding vector. No separate knowledge_vec join table.
 */

import { createHash } from 'crypto';
import { pool } from '../db/index.js';
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

let initialized = false;

/** Ensure pgvector extension and table exist. Safe to call multiple times. */
export async function initStore(): Promise<void> {
  if (initialized) return;

  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('project', 'product', 'guide')),
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      content_hash TEXT,
      embedding vector(${DIMENSIONS}),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type, source, title)
    )
  `);

  // Migration for existing installs: add embedding column if missing
  await pool.query(`
    ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(${DIMENSIONS})
  `);
  await pool.query(`
    ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS content_hash TEXT
  `);
  await pool.query(`
    ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);

  // Migrate data from legacy knowledge_vec table if it exists
  const legacyExists = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'knowledge_vec'
  `);
  if (legacyExists.rows.length > 0) {
    const migrated = await pool.query(`
      UPDATE knowledge_chunks c
      SET embedding = v.embedding
      FROM knowledge_vec v
      WHERE v.chunk_id = c.id AND c.embedding IS NULL
    `);
    if (migrated.rowCount && migrated.rowCount > 0) {
      logger.info({ migrated: migrated.rowCount }, 'Migrated embeddings from knowledge_vec to knowledge_chunks');
    }
    // Drop the legacy table after migration
    await pool.query('DROP TABLE IF EXISTS knowledge_vec');
    logger.info('Dropped legacy knowledge_vec table');
  }

  initialized = true;
  logger.info('RAG store initialized (single-table pgvector)');
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
  const hitIds = result.rows.map((r) => r.id).filter(Boolean);
  if (hitIds.length > 0) {
    pool.query(
      `UPDATE knowledge_chunks SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`,
      [hitIds],
    ).catch(() => {}); // non-fatal
  }

  return result.rows.map((row) => ({
    id: row.id,
    type: row.type as ChunkType,
    source: row.source,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.created_at,
    distance: row.distance,
  }));
}

/** List unique sources in the knowledge base, grouped by URL. */
export interface KnowledgeSourceSummary {
  source: string;
  type: ChunkType;
  title: string;
  chunks: number;
  firstAdded: string;
  lastAccessed: string;
}

export async function listSources(): Promise<KnowledgeSourceSummary[]> {
  await initStore();

  const result = await pool.query(`
    SELECT
      source,
      type,
      MIN(title) AS title,
      COUNT(*) AS chunks,
      MIN(created_at) AS first_added,
      MAX(last_accessed_at) AS last_accessed
    FROM knowledge_chunks
    GROUP BY source, type
    ORDER BY MAX(created_at) DESC
  `);

  return result.rows.map((row) => ({
    source: row.source,
    type: row.type as ChunkType,
    title: row.title,
    chunks: parseInt(row.chunks, 10),
    firstAdded: row.first_added,
    lastAccessed: row.last_accessed,
  }));
}

/** Get total chunk count, optionally filtered by type. */
export async function chunkCount(type?: ChunkType): Promise<number> {
  await initStore();

  const query = type
    ? 'SELECT COUNT(*) as count FROM knowledge_chunks WHERE type = $1'
    : 'SELECT COUNT(*) as count FROM knowledge_chunks';
  const params = type ? [type] : [];
  const result = await pool.query(query, params);
  return parseInt(result.rows[0].count, 10);
}

/** Delete all chunks of a given type. */
export async function clearChunks(type: ChunkType): Promise<number> {
  await initStore();

  const result = await pool.query(
    'DELETE FROM knowledge_chunks WHERE type = $1',
    [type],
  );
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
