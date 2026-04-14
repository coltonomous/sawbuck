-- Migration: add new tables and consolidate RAG schema
-- Run before drizzle-kit push to avoid interactive prompts.
-- All statements are idempotent (safe to re-run).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS regions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_miles INTEGER NOT NULL DEFAULT 30,
  cl_subdomain TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  auto_discovered BOOLEAN NOT NULL DEFAULT FALSE,
  last_ingested_at TIMESTAMP,
  content_hash TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_dismissals (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_dismissals_unique ON user_dismissals(user_id, listing_id);

-- Consolidate knowledge_chunks: add embedding + content_hash columns
-- so knowledge_vec is no longer needed as a separate table.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'knowledge_chunks') THEN
    -- Add columns if missing
    ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS content_hash TEXT;
    ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(384);

    -- Migrate embeddings from legacy knowledge_vec table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'knowledge_vec') THEN
      UPDATE knowledge_chunks c
      SET embedding = v.embedding
      FROM knowledge_vec v
      WHERE v.chunk_id = c.id AND c.embedding IS NULL;

      DROP TABLE knowledge_vec;
    END IF;
  END IF;
END $$;
