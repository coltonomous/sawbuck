/**
 * Post-evaluation node: identifies knowledge gaps in the RAG knowledge base
 * and queues new sources for automatic ingestion.
 *
 * Strategy (in priority order):
 * 1. Deterministic URLs — wood species → wood-database.com, furniture types → Family Handyman
 * 2. Brave Search API — if BRAVE_API_KEY is set, search for relevant articles
 *    and queue the top result URLs (actual article pages, not search pages)
 */

import { db } from '../../db/index.js';
import { knowledgeSources } from '../../db/schema.js';
import { search, initStore } from '../../rag/store.js';
import { embed } from '../../rag/embeddings.js';
import type { AgentState } from '../state.js';
import logger from '../../lib/logger.js';

const MAX_SOURCES_PER_RUN = 5;
const GAP_DISTANCE_THRESHOLD = 0.8;

// wood-database.com slugs for common species. Covers the cases most likely
// to show up in listings — add more as needed.
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

interface BraveResult {
  title: string;
  url: string;
  description?: string;
}

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
    const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
    return data.web?.results ?? [];
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Brave Search failed');
    return [];
  }
}

// Domains known to be scrapable and relevant for furniture refinishing knowledge.
// Blocklisted domains get filtered out so we don't queue pages that will 404/403.
const ALLOWED_DOMAINS = [
  'familyhandyman.com', 'thisoldhouse.com', 'thespruce.com',
  'thesprucecrafts.com', 'wood-database.com', 'popularwoodworking.com',
  'woodcraft.com', 'finewoodworking.com', 'wikihow.com', 'wikipedia.org',
  'generalfinishes.com', 'bobvila.com', 'lowes.com', 'homedepot.com',
  'doityourself.com', 'hunker.com', 'instructables.com',
];

function isAllowedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

interface KnowledgeGap {
  furnitureType: string;
  woodSpecies: string | null;
  style: string | null;
  query: string;
}

async function queueUrl(url: string, title: string, meta: Record<string, unknown>): Promise<boolean> {
  try {
    const result = await db.insert(knowledgeSources).values({
      type: 'guide',
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

export async function discoverKnowledge(state: AgentState): Promise<Partial<AgentState>> {
  if (state.qualifiedListings.length === 0) return {};

  try {
    await initStore();
  } catch {
    return {};
  }

  const gaps: KnowledgeGap[] = [];

  for (const listing of state.qualifiedListings) {
    const { furnitureType, furnitureStyle, woodSpecies } = listing.evaluation;
    const queryParts = [furnitureType];
    if (woodSpecies) queryParts.push(woodSpecies);
    queryParts.push('refinishing');
    const query = queryParts.join(' ');

    try {
      const embedding = await embed(query);
      const results = await search(embedding, 3, 'guide');
      const bestDistance = results.length > 0 ? Math.min(...results.map((r) => r.distance)) : 1.0;
      if (bestDistance > GAP_DISTANCE_THRESHOLD) {
        gaps.push({ furnitureType, woodSpecies: woodSpecies ?? null, style: furnitureStyle ?? null, query });
      }
    } catch (err) {
      logger.warn({ query, err: String(err) }, 'Knowledge gap check failed');
    }
  }

  if (gaps.length === 0) {
    logger.info('No knowledge gaps detected');
    return {};
  }

  // Deduplicate by type + species
  const seen = new Set<string>();
  const uniqueGaps = gaps.filter((g) => {
    const key = `${g.furnitureType}:${g.woodSpecies ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_SOURCES_PER_RUN);

  logger.info({ gaps: uniqueGaps.length }, 'Knowledge gaps detected — queuing sources');

  let queued = 0;

  for (const gap of uniqueGaps) {
    const meta = { gap: { furnitureType: gap.furnitureType, woodSpecies: gap.woodSpecies } };

    // 1. Deterministic: wood species → wood-database.com
    if (gap.woodSpecies) {
      const url = woodDbUrl(gap.woodSpecies);
      if (url) {
        const title = `${gap.woodSpecies} — Wood Species Profile`;
        if (await queueUrl(url, title, meta)) queued++;
      }
    }

    // 2. Brave Search for the broader gap query (type + species + refinishing)
    const braveResults = await braveSearch(`${gap.query} furniture guide`);
    for (const result of braveResults) {
      if (!isAllowedUrl(result.url)) continue;
      if (await queueUrl(result.url, result.title, meta)) {
        queued++;
        break; // one Brave result per gap is enough
      }
    }
  }

  logger.info({ gapsFound: uniqueGaps.length, sourcesQueued: queued }, 'Knowledge gap detection complete');
  return {};
}
