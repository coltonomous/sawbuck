#!/usr/bin/env tsx
/**
 * Knowledge base ingestion CLI.
 *
 * Usage:
 *   npm run ingest              # ingest all sources (projects + products + guides)
 *   npm run ingest -- --only projects
 *   npm run ingest -- --only products
 *   npm run ingest -- --only guides
 *   npm run ingest -- --stats   # show knowledge base stats without ingesting
 *
 * The first run downloads the embedding model (~80 MB) which takes a minute.
 * Subsequent runs are fast.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { warmup } from '../server/rag/embeddings.js';
import { chunkCount, getDb } from '../server/rag/store.js';
import { ingestProjects } from '../server/rag/ingest/projects.js';
import { ingestProducts, type ProductSource } from '../server/rag/ingest/products.js';
import { ingestGuides, type GuideSource } from '../server/rag/ingest/guides.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Sources {
  products: ProductSource[];
  guides: GuideSource[];
}

function loadSources(): Sources {
  const raw = readFileSync(resolve(ROOT, 'server/rag/sources.json'), 'utf-8');
  return JSON.parse(raw);
}

function printStats() {
  console.log('\n📊 Knowledge Base Stats:');
  console.log(`   Projects:  ${chunkCount('project')} chunks`);
  console.log(`   Products:  ${chunkCount('product')} chunks`);
  console.log(`   Guides:    ${chunkCount('guide')} chunks`);
  console.log(`   Total:     ${chunkCount()} chunks\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const statsOnly = args.includes('--stats');

  // Initialize sqlite-vec tables
  getDb();

  if (statsOnly) {
    printStats();
    process.exit(0);
  }

  console.log('Loading embedding model (first run downloads ~80 MB)...');
  await warmup();
  console.log('Embedding model ready.\n');

  const sources = loadSources();
  const results: Record<string, { ingested: number; failed?: number; skipped?: number }> = {};

  if (!only || only === 'projects') {
    console.log('--- Ingesting completed projects ---');
    results.projects = await ingestProjects();
    console.log(`   ${results.projects.ingested} project chunks ingested\n`);
  }

  if (!only || only === 'products') {
    console.log(`--- Ingesting ${sources.products.length} product sources ---`);
    results.products = await ingestProducts(sources.products);
    console.log(`   ${results.products.ingested} product chunks ingested, ${results.products.failed} failed\n`);
  }

  if (!only || only === 'guides') {
    console.log(`--- Ingesting ${sources.guides.length} guide sources ---`);
    results.guides = await ingestGuides(sources.guides);
    console.log(`   ${results.guides.ingested} guide chunks ingested, ${results.guides.failed} failed\n`);
  }

  printStats();
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
