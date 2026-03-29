/**
 * Tests for the RAG vector store (sqlite-vec backed).
 *
 * Uses a separate in-memory database to avoid touching the real DB.
 * Mocks the embeddings module since the model can't be downloaded in CI.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

// We test the store logic directly against a fresh in-memory DB
// rather than importing store.ts (which binds to the real DB path).

const DIMENSIONS = 384;

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  sqliteVec.load(db);

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

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${DIMENSIONS}]
    )
  `);

  return db;
}

function randomVec(): Float32Array {
  const vec = new Float32Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) vec[i] = Math.random() - 0.5;
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < DIMENSIONS; i++) vec[i] /= norm;
  return vec;
}

function insertChunk(
  db: Database.Database,
  type: string,
  source: string,
  title: string,
  content: string,
  embedding: Float32Array,
  metadata: Record<string, unknown> = {},
): number | null {
  const result = db.prepare(`
    INSERT OR IGNORE INTO knowledge_chunks (type, source, title, content, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(type, source, title, content, JSON.stringify(metadata));

  if (result.changes === 0) return null;
  const chunkId = BigInt(result.lastInsertRowid);

  db.prepare(`
    INSERT INTO knowledge_vec (chunk_id, embedding) VALUES (?, ?)
  `).run(chunkId, Buffer.from(embedding.buffer));

  return Number(chunkId);
}

function searchChunks(
  db: Database.Database,
  queryVec: Float32Array,
  k: number,
  type?: string,
) {
  let sql: string;
  let params: unknown[];

  if (type) {
    sql = `
      SELECT v.chunk_id, v.distance, c.*
      FROM knowledge_vec v
      JOIN knowledge_chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ? AND k = ? AND c.type = ?
      ORDER BY v.distance ASC
    `;
    params = [Buffer.from(queryVec.buffer), k, type];
  } else {
    sql = `
      SELECT v.chunk_id, v.distance, c.*
      FROM knowledge_vec v
      JOIN knowledge_chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ? AND k = ?
      ORDER BY v.distance ASC
    `;
    params = [Buffer.from(queryVec.buffer), k];
  }

  return db.prepare(sql).all(...params) as Array<{
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
}

describe('RAG store (sqlite-vec)', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  it('creates tables without error', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('knowledge_chunks');
  });

  it('inserts a chunk and returns its id', () => {
    const vec = randomVec();
    const id = insertChunk(db, 'project', 'project:1', 'oak dresser flip', 'Completed flip: dresser', vec);
    expect(id).toBeGreaterThan(0);
  });

  it('skips duplicates (same type + source + title)', () => {
    const vec = randomVec();
    const id = insertChunk(db, 'project', 'project:1', 'oak dresser flip', 'Different content', vec);
    expect(id).toBeNull();
  });

  it('searches by vector similarity', () => {
    // Insert a few chunks with known embeddings
    const vec1 = new Float32Array(DIMENSIONS).fill(0);
    vec1[0] = 1; // unit vector along dim 0

    const vec2 = new Float32Array(DIMENSIONS).fill(0);
    vec2[1] = 1; // unit vector along dim 1

    const vec3 = new Float32Array(DIMENSIONS).fill(0);
    vec3[0] = 0.9;
    vec3[1] = 0.1; // close to vec1
    // normalize
    const norm3 = Math.sqrt(0.81 + 0.01);
    vec3[0] /= norm3;
    vec3[1] /= norm3;

    insertChunk(db, 'guide', 'guide:1', 'Sanding guide', 'How to sand furniture', vec1);
    insertChunk(db, 'guide', 'guide:2', 'Painting guide', 'How to paint furniture', vec2);
    insertChunk(db, 'product', 'product:1', 'Sandpaper 220', 'Fine grit sandpaper', vec3);

    // Search with vec1 — should find guide:1 closest, then product:1
    const results = searchChunks(db, vec1, 3);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].title).toBe('Sanding guide');
  });

  it('filters search by type', () => {
    const queryVec = new Float32Array(DIMENSIONS).fill(0);
    queryVec[0] = 1;

    const results = searchChunks(db, queryVec, 10, 'guide');
    for (const r of results) {
      expect(r.type).toBe('guide');
    }
  });

  it('stores and retrieves metadata as JSON', () => {
    const vec = randomVec();
    insertChunk(db, 'project', 'project:99', 'walnut table flip', 'Completed flip', vec, {
      purchasePrice: 80,
      soldPrice: 340,
      roiPercentage: 134,
    });

    const row = db.prepare(
      "SELECT metadata FROM knowledge_chunks WHERE source = 'project:99'"
    ).get() as { metadata: string };
    const meta = JSON.parse(row.metadata);
    expect(meta.purchasePrice).toBe(80);
    expect(meta.soldPrice).toBe(340);
    expect(meta.roiPercentage).toBe(134);
  });

  it('deletes chunks by type', () => {
    const beforeGuides = db.prepare(
      "SELECT COUNT(*) as count FROM knowledge_chunks WHERE type = 'guide'"
    ).get() as { count: number };
    expect(beforeGuides.count).toBeGreaterThan(0);

    // Delete guides
    const ids = db.prepare(
      "SELECT id FROM knowledge_chunks WHERE type = 'guide'"
    ).all() as Array<{ id: number }>;
    for (const { id } of ids) {
      db.prepare('DELETE FROM knowledge_vec WHERE chunk_id = ?').run(id);
    }
    db.prepare("DELETE FROM knowledge_chunks WHERE type = 'guide'").run();

    const afterGuides = db.prepare(
      "SELECT COUNT(*) as count FROM knowledge_chunks WHERE type = 'guide'"
    ).get() as { count: number };
    expect(afterGuides.count).toBe(0);

    // Products should still be there
    const products = db.prepare(
      "SELECT COUNT(*) as count FROM knowledge_chunks WHERE type = 'product'"
    ).get() as { count: number };
    expect(products.count).toBeGreaterThan(0);
  });

  it('handles batch insert in a transaction', () => {
    const chunks = Array.from({ length: 5 }, (_, i) => ({
      type: 'guide' as const,
      source: `batch:${i}`,
      title: `Batch guide ${i}`,
      content: `Guide content ${i}`,
    }));
    const vecs = chunks.map(() => randomVec());

    const insertChunkStmt = db.prepare(`
      INSERT OR IGNORE INTO knowledge_chunks (type, source, title, content, metadata)
      VALUES (?, ?, ?, ?, '{}')
    `);
    const insertVecStmt = db.prepare(`
      INSERT INTO knowledge_vec (chunk_id, embedding) VALUES (?, ?)
    `);

    let count = 0;
    const tx = db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const result = insertChunkStmt.run(
          chunks[i].type, chunks[i].source, chunks[i].title, chunks[i].content,
        );
        if (result.changes > 0) {
          insertVecStmt.run(BigInt(result.lastInsertRowid), Buffer.from(vecs[i].buffer));
          count++;
        }
      }
    });
    tx();

    expect(count).toBe(5);
  });
});
