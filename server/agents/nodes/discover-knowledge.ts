/**
 * Post-evaluation node: identifies knowledge gaps in the RAG knowledge base
 * and queues new sources for automatic ingestion.
 *
 * Checks both guide and product coverage for each qualified listing.
 * Strategy (in priority order):
 * 1. Deterministic URLs — wood species → wood-database.com
 * 2. Brave Search API — if BRAVE_API_KEY is set, resolves the gap query to
 *    real article URLs filtered to a known-scrapable domain allowlist
 */

import { db } from '../../db/index.js';
import { knowledgeSources } from '../../db/schema.js';
import { search, initStore } from '../../rag/store.js';
import { embed } from '../../rag/embeddings.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

const GAP_DISTANCE_THRESHOLD = 0.6;
const MAX_GAPS_PER_RUN = 5;

// wood-database.com slugs for common species
const WOOD_DB_SLUGS: Record<string, string> = {
  oak: 'white-oak', white_oak: 'white-oak', red_oak: 'red-oak',
  walnut: 'black-walnut', black_walnut: 'black-walnut',
  cherry: 'black-cherry', black_cherry: 'black-cherry',
  maple: 'hard-maple', hard_maple: 'hard-maple', soft_maple: 'soft-maple',
  teak: 'teak',
  mahogany: 'honduran-mahogany', honduran_mahogany: 'honduran-mahogany',
  pine: 'eastern-white-pine', white_pine: 'eastern-white-pine',
  birch: 'yellow-birch', yellow_birch: 'yellow-birch',
  poplar: 'yellow-poplar', tulip_poplar: 'yellow-poplar',
  cedar: 'eastern-red-cedar', red_cedar: 'eastern-red-cedar',
  ash: 'white-ash', white_ash: 'white-ash',
  beech: 'american-beech',
  hickory: 'shagbark-hickory',
  fir: 'douglas-fir', douglas_fir: 'douglas-fir',
  rosewood: 'east-indian-rosewood',
  elm: 'american-elm',
  alder: 'red-alder',
  bamboo: 'moso-bamboo',
};

function woodDbUrl(species: string): string | null {
  const key = species.toLowerCase().replace(/[\s-]+/g, '_');
  const slug = WOOD_DB_SLUGS[key];
  return slug ? `https://www.wood-database.com/${slug}/` : null;
}

// Domains known to be scrapable and relevant
const ALLOWED_DOMAINS = [
  'familyhandyman.com', 'thisoldhouse.com', 'thespruce.com',
  'thesprucecrafts.com', 'wood-database.com', 'popularwoodworking.com',
  'woodcraft.com', 'wikihow.com', 'wikipedia.org',
  'generalfinishes.com', 'bobvila.com', 'lowes.com', 'homedepot.com',
  'doityourself.com', 'hunker.com', 'instructables.com',
  'minwax.com', 'rustoleum.com', 'citristrip.com',
];

function isAllowedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

interface BraveResult { title: string; url: string }

async function braveSearch(query: string): Promise<BraveResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&result_filter=web`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Brave Search returned error');
      return [];
    }
    const data = await res.json() as { web?: { results?: BraveResult[] } };
    return data.web?.results ?? [];
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Brave Search failed');
    return [];
  }
}

async function queueUrl(
  url: string,
  title: string,
  type: 'guide' | 'product',
  meta: Record<string, unknown>,
): Promise<boolean> {
  try {
    const result = await db.insert(knowledgeSources).values({
      type,
      url,
      title,
      metadata: JSON.stringify({ autoDiscoveredFrom: 'knowledge-gap-detection', ...meta }),
      autoDiscovered: true,
    }).onConflictDoNothing().returning({ id: knowledgeSources.id });
    return result.length > 0;
  } catch {
    return false;
  }
}

async function hasGap(query: string, type: 'guide' | 'product'): Promise<boolean> {
  const embedding = await embed(query);
  const results = await search(embedding, 3, type);
  const bestDistance = results.length > 0 ? Math.min(...results.map((r) => r.distance)) : 1.0;
  return bestDistance > GAP_DISTANCE_THRESHOLD;
}

export async function discoverKnowledge(state: AgentState): Promise<Partial<AgentState>> {
  if (state.qualifiedListings.length === 0) return {};

  try {
    await initStore();
  } catch {
    return {};
  }

  let queued = 0;
  let gapsFound = 0;

  // Deduplicate by type + species across listings
  const seen = new Set<string>();

  for (const listing of state.qualifiedListings.slice(0, MAX_GAPS_PER_RUN)) {
    const { furnitureType, furnitureStyle, woodSpecies } = listing.evaluation;
    const dedupeKey = `${furnitureType}:${woodSpecies ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const meta = { gap: { furnitureType, woodSpecies } };

    // --- Guide gap ---
    const guideQuery = [furnitureType, woodSpecies, 'refinishing'].filter(Boolean).join(' ');
    try {
      if (await hasGap(guideQuery, 'guide')) {
        gapsFound++;

        // 1. Deterministic: wood species → wood-database.com
        if (woodSpecies) {
          const url = woodDbUrl(woodSpecies);
          if (url && await queueUrl(url, `${woodSpecies} — Wood Species Profile`, 'guide', meta)) queued++;
        }

        // 2. Brave Search for broader guide
        const braveResults = await braveSearch(`${guideQuery} furniture refinishing guide`);
        for (const result of braveResults) {
          if (!isAllowedUrl(result.url)) continue;
          if (await queueUrl(result.url, result.title, 'guide', meta)) { queued++; break; }
        }
      }
    } catch (err) {
      logger.warn({ query: guideQuery, err: String(err) }, 'Guide gap check failed');
    }

    // --- Product gap ---
    const productQuery = [woodSpecies, furnitureType, 'finish stain product'].filter(Boolean).join(' ');
    try {
      if (await hasGap(productQuery, 'product')) {
        gapsFound++;

        // Brave Search for product page
        const braveResults = await braveSearch(`${woodSpecies ?? furnitureType} wood finish product refinishing`);
        for (const result of braveResults) {
          if (!isAllowedUrl(result.url)) continue;
          if (await queueUrl(result.url, result.title, 'product', meta)) { queued++; break; }
        }
      }
    } catch (err) {
      logger.warn({ query: productQuery, err: String(err) }, 'Product gap check failed');
    }
  }

  if (gapsFound > 0) {
    logger.info({ gapsFound, sourcesQueued: queued }, 'Knowledge gap detection complete');
  } else {
    logger.info('No knowledge gaps detected');
  }

  return {};
}
