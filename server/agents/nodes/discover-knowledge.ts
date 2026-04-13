/**
 * Post-evaluation node: identifies knowledge gaps in the RAG knowledge base
 * and queues new sources for automatic ingestion.
 *
 * For each qualified listing, checks if the knowledge base has relevant
 * guides/products for the identified furniture type and wood species.
 * If not, builds candidate URLs from known-reliable domains.
 */

import { db } from '../../db/index.js';
import { knowledgeSources } from '../../db/schema.js';
import { search, initStore } from '../../rag/store.js';
import { embed } from '../../rag/embeddings.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

const MAX_SOURCES_PER_RUN = 5;
const GAP_DISTANCE_THRESHOLD = 0.8;

// Known-reliable domains for furniture refinishing knowledge
const GUIDE_SEARCH_TEMPLATES = [
  (terms: string) => `https://www.popularwoodworking.com/?s=${encodeURIComponent(terms)}`,
  (terms: string) => `https://www.minwax.com/en/search?query=${encodeURIComponent(terms)}`,
  (terms: string) => `https://generalfinishes.com/search/node/${encodeURIComponent(terms)}`,
];

interface KnowledgeGap {
  furnitureType: string;
  woodSpecies: string | null;
  style: string | null;
  query: string;
  bestDistance: number;
}

export async function discoverKnowledge(state: AgentState): Promise<Partial<AgentState>> {
  if (state.qualifiedListings.length === 0) {
    return {};
  }

  try {
    await initStore();
  } catch {
    return {};
  }

  const gaps: KnowledgeGap[] = [];
  let sourcesQueued = 0;

  for (const listing of state.qualifiedListings) {
    const { furnitureType, furnitureStyle, woodSpecies } = listing.evaluation;

    // Build a search query from the evaluation
    const queryParts = [furnitureType];
    if (woodSpecies) queryParts.push(woodSpecies);
    queryParts.push('refinishing');
    const query = queryParts.join(' ');

    try {
      const queryEmbedding = await embed(query);
      const results = await search(queryEmbedding, 3, 'guide');

      const bestDistance = results.length > 0
        ? Math.min(...results.map((r) => r.distance))
        : 1.0;

      if (bestDistance > GAP_DISTANCE_THRESHOLD) {
        gaps.push({
          furnitureType,
          woodSpecies,
          style: furnitureStyle,
          query,
          bestDistance,
        });
      }
    } catch (err) {
      logger.warn({ query, error: String(err) }, 'Knowledge gap check failed');
    }
  }

  if (gaps.length === 0) {
    logger.info('No knowledge gaps detected');
    return {};
  }

  logger.info({ gaps: gaps.length }, 'Knowledge gaps detected');

  // Deduplicate gaps by furniture type + wood species
  const seen = new Set<string>();
  const uniqueGaps = gaps.filter((g) => {
    const key = `${g.furnitureType}:${g.woodSpecies ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_SOURCES_PER_RUN);

  for (const gap of uniqueGaps) {
    // Queue search URLs from reliable domains
    const searchTerms = [gap.furnitureType, gap.woodSpecies, 'refinishing'].filter(Boolean).join(' ');

    for (const template of GUIDE_SEARCH_TEMPLATES) {
      const url = template(searchTerms);

      try {
        await db.insert(knowledgeSources).values({
          type: 'guide',
          url,
          title: `${gap.furnitureType} ${gap.woodSpecies ?? ''} refinishing guide`.trim(),
          metadata: JSON.stringify({
            autoDiscoveredFrom: 'knowledge-gap-detection',
            gap: { furnitureType: gap.furnitureType, woodSpecies: gap.woodSpecies },
          }),
          autoDiscovered: true,
        }).onConflictDoNothing();

        sourcesQueued++;
      } catch (err) {
        // Duplicate URL — fine, skip
        logger.debug({ url, error: String(err) }, 'Failed to queue knowledge source');
      }
    }
  }

  logger.info({
    gapsFound: uniqueGaps.length,
    sourcesQueued,
  }, 'Knowledge gap detection complete');

  return {};
}
