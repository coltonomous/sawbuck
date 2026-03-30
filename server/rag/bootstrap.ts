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
import { chunkCount, getDb } from './store.js';
import { ingestProjects } from './ingest/projects.js';
import { ingestProducts, type ProductSource } from './ingest/products.js';
import { ingestGuides, type GuideSource } from './ingest/guides.js';
import logger from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Sources {
  products: ProductSource[];
  guides: GuideSource[];
}

export async function bootstrapKnowledgeBase(): Promise<void> {
  try {
    await warmup();

    getDb(); // ensure vector tables exist

    const total = chunkCount();
    if (total > 0) {
      logger.info({ chunks: total }, 'Knowledge base already populated');
      return;
    }

    logger.info('Knowledge base empty — running initial ingestion');

    const sources: Sources = JSON.parse(
      readFileSync(resolve(__dirname, 'sources.json'), 'utf-8'),
    );

    const projectResult = await ingestProjects();
    const productResult = await ingestProducts(sources.products);
    const guideResult = await ingestGuides(sources.guides);

    logger.info(
      {
        projects: projectResult.ingested,
        products: productResult.ingested,
        guides: guideResult.ingested,
      },
      'Initial knowledge base ingestion complete',
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Knowledge base bootstrap failed');
  }
}
