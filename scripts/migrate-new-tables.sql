-- Migration: add regions and knowledge_sources tables
-- Run before drizzle-kit push to avoid interactive prompts

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

-- Add content_hash to knowledge_chunks if it doesn't exist (for existing installs).
-- This is a no-op if the table doesn't exist yet (first deploy) — initStore() creates it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'knowledge_chunks') THEN
    ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS content_hash TEXT;
  END IF;
END $$;
