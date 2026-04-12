/**
 * Vector store backed by pgvector (Postgres extension).
 *
 * Uses the same Postgres database as the main app. The knowledge_chunks
 * and knowledge_vec tables are created via raw SQL since they use
 * pgvector types not supported by Drizzle.
 */

import { pool } from '../db/index.js';
import { DIMENSIONS } from './embeddings.js';
import logger from '../lib/logger.js';
import pgvector from 'pgvector';

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

/** Ensure pgvector extension and tables exist. Safe to call multiple times. */
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
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type, source, title)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_vec (
      chunk_id INTEGER PRIMARY KEY REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
      embedding vector(${DIMENSIONS}) NOT NULL
    )
  `);

  initialized = true;
  logger.info('RAG tables initialized (pgvector)');
}

/**
 * Insert a chunk + its embedding vector. Skips silently on duplicate
 * (same type + source + title).
 */
export async function upsertChunk(
  chunk: Omit<KnowledgeChunk, 'id' | 'createdAt'>,
  embedding: Float32Array,
): Promise<number | null> {
  await initStore();

  const result = await pool.query(
    `INSERT INTO knowledge_chunks (type, source, title, content, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (type, source, title) DO NOTHING
     RETURNING id`,
    [chunk.type, chunk.source, chunk.title, chunk.content, JSON.stringify(chunk.metadata)],
  );

  if (result.rows.length === 0) return null;

  const chunkId = result.rows[0].id;
  await pool.query(
    'INSERT INTO knowledge_vec (chunk_id, embedding) VALUES ($1, $2)',
    [chunkId, pgvector.toSql(Array.from(embedding))],
  );

  return chunkId;
}

/**
 * Batch insert chunks + embeddings in a transaction.
 * Returns count of newly inserted chunks.
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
      const result = await client.query(
        `INSERT INTO knowledge_chunks (type, source, title, content, metadata)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (type, source, title) DO NOTHING
         RETURNING id`,
        [chunk.type, chunk.source, chunk.title, chunk.content, JSON.stringify(chunk.metadata)],
      );

      if (result.rows.length > 0) {
        const chunkId = result.rows[0].id;
        await client.query(
          'INSERT INTO knowledge_vec (chunk_id, embedding) VALUES ($1, $2)',
          [chunkId, pgvector.toSql(Array.from(embeddings[i]))],
        );
        inserted++;
      }
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
      SELECT v.chunk_id, v.embedding <=> $1 as distance, c.*
      FROM knowledge_vec v
      JOIN knowledge_chunks c ON c.id = v.chunk_id
      WHERE c.type = $2
      ORDER BY v.embedding <=> $1
      LIMIT $3
    `;
    params = [embeddingSql, type, k];
  } else {
    query = `
      SELECT v.chunk_id, v.embedding <=> $1 as distance, c.*
      FROM knowledge_vec v
      JOIN knowledge_chunks c ON c.id = v.chunk_id
      ORDER BY v.embedding <=> $1
      LIMIT $2
    `;
    params = [embeddingSql, k];
  }

  const result = await pool.query(query, params);

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

/** Delete all chunks of a given type (useful for re-ingestion). */
export async function clearChunks(type: ChunkType): Promise<number> {
  await initStore();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete vectors first (FK constraint)
    await client.query(
      'DELETE FROM knowledge_vec WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE type = $1)',
      [type],
    );

    const result = await client.query(
      'DELETE FROM knowledge_chunks WHERE type = $1',
      [type],
    );

    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
