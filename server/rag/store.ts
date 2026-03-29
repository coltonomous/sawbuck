/**
 * Vector store backed by sqlite-vec (vec0 virtual table).
 *
 * Uses the same SQLite database as the main app. The vec0 table lives
 * alongside Drizzle-managed tables but is created/queried via raw SQL
 * since Drizzle doesn't support virtual tables.
 *
 * Schema:
 *   knowledge_chunks  — metadata (text, source, type, etc.)
 *   knowledge_vec     — vec0 virtual table storing 384-dim float32 vectors
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { DB_PATH } from '../lib/paths.js';
import { DIMENSIONS } from './embeddings.js';
import logger from '../lib/logger.js';

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

let db: Database.Database | null = null;

/**
 * Get (or create) the RAG database connection.
 *
 * Shares the same sawbuck.db file as the main app. Loads the sqlite-vec
 * extension and ensures tables exist. Safe to call multiple times.
 */
export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Load sqlite-vec extension
  sqliteVec.load(db);
  logger.info('sqlite-vec extension loaded');

  // Metadata table (plain SQL — Drizzle doesn't own this)
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('project', 'product', 'guide')),
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, source, title)
    )
  `);

  // Vec0 virtual table — 384-dim float32 vectors, keyed by chunk id
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${DIMENSIONS}]
    )
  `);

  logger.info('RAG tables initialized');
  return db;
}

/**
 * Insert a chunk + its embedding vector. Skips silently on duplicate
 * (same type + source + title).
 */
export function upsertChunk(
  chunk: Omit<KnowledgeChunk, 'id' | 'createdAt'>,
  embedding: Float32Array,
): number | null {
  const conn = getDb();

  const insertChunk = conn.prepare(`
    INSERT OR IGNORE INTO knowledge_chunks (type, source, title, content, metadata)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = insertChunk.run(
    chunk.type,
    chunk.source,
    chunk.title,
    chunk.content,
    JSON.stringify(chunk.metadata),
  );

  if (result.changes === 0) return null; // duplicate, skipped

  const chunkId = Number(result.lastInsertRowid);

  const insertVec = conn.prepare(`
    INSERT INTO knowledge_vec (chunk_id, embedding)
    VALUES (?, ?)
  `);
  insertVec.run(chunkId, Buffer.from(embedding.buffer));

  return chunkId;
}

/**
 * Batch insert chunks + embeddings in a transaction.
 * Returns count of newly inserted chunks.
 */
export function upsertChunks(
  chunks: Omit<KnowledgeChunk, 'id' | 'createdAt'>[],
  embeddings: Float32Array[],
): number {
  if (chunks.length !== embeddings.length) {
    throw new Error('chunks and embeddings arrays must have the same length');
  }

  const conn = getDb();
  let inserted = 0;

  const insertChunk = conn.prepare(`
    INSERT OR IGNORE INTO knowledge_chunks (type, source, title, content, metadata)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertVec = conn.prepare(`
    INSERT INTO knowledge_vec (chunk_id, embedding)
    VALUES (?, ?)
  `);

  const tx = conn.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const result = insertChunk.run(
        chunk.type,
        chunk.source,
        chunk.title,
        chunk.content,
        JSON.stringify(chunk.metadata),
      );
      if (result.changes > 0) {
        const chunkId = Number(result.lastInsertRowid);
        insertVec.run(chunkId, Buffer.from(embeddings[i].buffer));
        inserted++;
      }
    }
  });

  tx();
  return inserted;
}

/**
 * Search for the k nearest chunks to a query embedding.
 * Optionally filter by chunk type.
 */
export function search(
  queryEmbedding: Float32Array,
  k = 5,
  type?: ChunkType,
): SearchResult[] {
  const conn = getDb();

  // Vec0 knn query returns (chunk_id, distance) ordered by distance ASC
  let sql: string;
  let params: unknown[];

  if (type) {
    sql = `
      SELECT v.chunk_id, v.distance, c.*
      FROM knowledge_vec v
      JOIN knowledge_chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ?
        AND k = ?
        AND c.type = ?
      ORDER BY v.distance ASC
    `;
    params = [Buffer.from(queryEmbedding.buffer), k, type];
  } else {
    sql = `
      SELECT v.chunk_id, v.distance, c.*
      FROM knowledge_vec v
      JOIN knowledge_chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ?
        AND k = ?
      ORDER BY v.distance ASC
    `;
    params = [Buffer.from(queryEmbedding.buffer), k];
  }

  const rows = conn.prepare(sql).all(...params) as Array<{
    chunk_id: number;
    distance: number;
    id: number;
    type: string;
    source: string;
    title: string;
    content: string;
    metadata: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type as ChunkType,
    source: row.source,
    title: row.title,
    content: row.content,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    distance: row.distance,
  }));
}

/** Get total chunk count, optionally filtered by type. */
export function chunkCount(type?: ChunkType): number {
  const conn = getDb();
  const sql = type
    ? `SELECT COUNT(*) as count FROM knowledge_chunks WHERE type = ?`
    : `SELECT COUNT(*) as count FROM knowledge_chunks`;
  const params = type ? [type] : [];
  const row = conn.prepare(sql).get(...params) as { count: number };
  return row.count;
}

/** Delete all chunks of a given type (useful for re-ingestion). */
export function clearChunks(type: ChunkType): number {
  const conn = getDb();
  const tx = conn.transaction(() => {
    // Get IDs to delete from vec table
    const ids = conn
      .prepare(`SELECT id FROM knowledge_chunks WHERE type = ?`)
      .all(type) as Array<{ id: number }>;

    for (const { id } of ids) {
      conn.prepare(`DELETE FROM knowledge_vec WHERE chunk_id = ?`).run(id);
    }

    const result = conn
      .prepare(`DELETE FROM knowledge_chunks WHERE type = ?`)
      .run(type);
    return result.changes;
  });
  return tx();
}
