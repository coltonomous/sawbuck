/**
 * Warm up the embedding model and seed the knowledge base on first deploy.
 *
 * Called as fire-and-forget after the server starts listening. If the
 * knowledge base already has data (persistent volume), ingestion is skipped.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { warmup } from './embeddings.js';
import { chunkCount, initStore, evictExcess, type ChunkType } from './store.js';
import { ingestProjects } from './ingest/projects.js';
import { ingestProducts, type ProductSource } from './ingest/products.js';
import { ingestGuides, type GuideSource } from './ingest/guides.js';
import { processSourceQueue } from './ingest/worker.js';
import { agentConfig } from '../agents/config.js';
import logger from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Sources {
  products: ProductSource[];
  guides: GuideSource[];
}

export async function bootstrapKnowledgeBase(): Promise<void> {
  try {
    await warmup();

    await initStore(); // ensure vector tables exist

    const total = await chunkCount();
    logger.info({ chunks: total }, total > 0
      ? 'Knowledge base: running incremental sync'
      : 'Knowledge base empty — running initial ingestion');

    const sources: Sources = JSON.parse(
      readFileSync(resolve(__dirname, 'sources.json'), 'utf-8'),
    );

    const projectResult = await ingestProjects();
    const productResult = await ingestProducts(sources.products);
    const guideResult = await ingestGuides(sources.guides);

    // Process any pending auto-discovered sources
    const workerResult = await processSourceQueue();

    // Enforce per-type chunk limits to prevent unbounded growth
    const maxPerType = agentConfig.ragMaxChunksPerType;
    const types: ChunkType[] = ['project', 'product', 'guide'];
    const evicted: Record<string, number> = {};
    for (const type of types) {
      const removed = await evictExcess(type, maxPerType);
      if (removed > 0) evicted[type] = removed;
    }

    // Log newly ingested sources so each sync shows what was added
    const newProducts = productResult.sources;
    const newGuides = guideResult.sources;
    const newAutoDiscovered = workerResult.sources;

    if (newProducts.length > 0) {
      logger.info({ sources: newProducts.map((s) => `${s.brand} ${s.name}`) }, `Knowledge base: ingested ${newProducts.length} product sources`);
    }
    if (newGuides.length > 0) {
      logger.info({ sources: newGuides.map((s) => s.title) }, `Knowledge base: ingested ${newGuides.length} guide sources`);
    }
    if (newAutoDiscovered.length > 0) {
      logger.info({ sources: newAutoDiscovered.map((s) => ({ title: s.title, url: s.url })) }, `Knowledge base: ingested ${newAutoDiscovered.length} auto-discovered sources`);
    }

    // Warn loudly if a type has zero chunks after ingestion — indicates all source URLs are dead
    const guideChunks = await chunkCount('guide');
    const productChunks = await chunkCount('product');
    if (sources.guides.length > 0 && guideChunks === 0) {
      logger.error(
        { failed: guideResult.failed, sources: sources.guides.length },
        'Knowledge base: ZERO guide chunks — all guide URLs failed to fetch. Update sources.json with working URLs.',
      );
    }
    if (sources.products.length > 0 && productChunks === 0) {
      logger.error(
        { failed: productResult.failed, sources: sources.products.length },
        'Knowledge base: ZERO product chunks — all product URLs failed to fetch. Update sources.json with working URLs.',
      );
    }

    logger.info(
      {
        projects: projectResult.ingested,
        products: productResult.ingested,
        guides: guideResult.ingested,
        autoDiscovered: workerResult.ingested,
        productChunksTotal: productChunks,
        guideChunksTotal: guideChunks,
        ...(Object.keys(evicted).length > 0 && { evicted }),
      },
      'Knowledge base sync complete',
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Knowledge base bootstrap failed');
  }
}
