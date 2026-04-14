import { db } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { agentConfig } from '../../agents/config.js';
import { AntiBlockingController } from '../../agents/anti-blocking.js';
import { offerUpFetch, warmCookies } from './client.js';
import type { ScrapedCandidate, Region, EnrichResult } from '../common/types.js';
import logger from '../../lib/logger.js';

/**
 * Build OfferUp search URL with location params.
 * OfferUp's search pages embed results in __NEXT_DATA__ JSON.
 */
// Rotate search queries to cover more furniture types across runs.
// OfferUp's keyword search is noisy, so specific terms reduce junk.
const SEARCH_QUERIES = [
  'solid wood dresser',
  'wood table desk',
  'wood cabinet hutch',
  'vintage furniture wood',
  'mid century modern furniture',
  'wood bookcase shelf',
];

function searchUrl(region: Region, page: number): string {
  // Pick query based on page offset to vary results across retries
  const query = SEARCH_QUERIES[page % SEARCH_QUERIES.length];
  const params = new URLSearchParams({
    q: query,
    LOCATION_LATITUDE: String(region.latitude),
    LOCATION_LONGITUDE: String(region.longitude),
    SEARCH_RADIUS: String(region.radiusMiles),
  });
  if (page > 0) params.set('page', String(page + 1));
  return `https://offerup.com/search?${params}`;
}

interface OfferUpTile {
  __typename: string;
  listing?: {
    listingId: string;
    title: string;
    price: number | string | null;
    image?: { url?: string };
    locationName?: string;
    conditionText?: string;
  };
}

/**
 * Parse listings from OfferUp's __NEXT_DATA__ embedded JSON.
 */
function parseSearchPage(html: string): Array<{
  externalId: string;
  title: string;
  askingPrice: number | null;
  location: string;
  imageUrl: string | null;
}> {
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    logger.warn('OfferUp integration: no __NEXT_DATA__ found in search page');
    return [];
  }

  let tiles: OfferUpTile[];
  try {
    const data = JSON.parse(nextDataMatch[1]);
    const feed = data?.props?.pageProps?.searchFeedResponse ?? {};
    tiles = (feed.looseTiles ?? feed.tightTiles ?? []) as OfferUpTile[];
  } catch {
    logger.error('OfferUp integration: failed to parse __NEXT_DATA__');
    return [];
  }

  const results = [];
  for (const tile of tiles) {
    if (tile.__typename !== 'ModularFeedTileListing') continue;
    const item = tile.listing;
    if (!item?.listingId || !item?.title) continue;

    const price = typeof item.price === 'string' ? parseFloat(item.price) : item.price;

    results.push({
      externalId: item.listingId,
      title: item.title,
      askingPrice: price != null && !isNaN(price) ? price : null,
      location: item.locationName ?? '',
      imageUrl: item.image?.url ?? null,
    });
  }

  return results;
}

/**
 * Phase 1: Discover new listings from OfferUp search page.
 * Parses __NEXT_DATA__ from the server-rendered HTML.
 */
export async function discover(region: Region, page = 0): Promise<ScrapedCandidate[]> {
  await warmCookies({ latitude: region.latitude, longitude: region.longitude, radiusMiles: region.radiusMiles, name: region.name });

  const url = searchUrl(region, page);
  logger.info({ url, page, region: region.name }, 'OfferUp integration: fetching search page');

  const res = await offerUpFetch(url);

  if (!res.ok) {
    throw new Error(`OfferUp search page returned ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const parsed = parseSearchPage(html);

  logger.info({ count: parsed.length, region: region.name }, 'OfferUp integration: search items parsed');

  if (parsed.length === 0) return [];

  // Dedup against DB
  const externalIds = parsed.map((item) => item.externalId);
  const existing = await db
    .select({ externalId: listings.externalId })
    .from(listings)
    .where(and(eq(listings.platform, 'offerup'), inArray(listings.externalId, externalIds)));
  const existingIds = new Set(existing.map((e) => e.externalId));

  const newItems = parsed.filter((item) => !existingIds.has(item.externalId));
  logger.info({ total: parsed.length, new: newItems.length, existing: existingIds.size }, 'OfferUp integration: dedup results');

  return newItems.map((item) => ({
    externalId: item.externalId,
    platform: 'offerup',
    url: `https://offerup.com/item/detail/${item.externalId}`,
    title: item.title,
    askingPrice: item.askingPrice,
    location: item.location || region.name,
    imageUrls: item.imageUrl ? [item.imageUrl] : [],
  }));
}

/**
 * Phase 2: Enrich candidates that passed triage with full detail page data.
 * Fetches individual listing pages for descriptions and images.
 */
export async function enrich(candidates: ScrapedCandidate[]): Promise<EnrichResult> {
  if (candidates.length === 0) return { enriched: [], removedIds: [] };

  const antiBlocking = new AntiBlockingController({
    minDelayBetweenRequestsMs: agentConfig.minDelayBetweenRequestsMs,
    maxDelayBetweenRequestsMs: agentConfig.maxDelayBetweenRequestsMs,
    dailyRequestCap: agentConfig.dailyRequestCap,
  });

  const enriched: ScrapedCandidate[] = [];
  const removedIds: string[] = [];

  for (const candidate of candidates) {
    try {
      await antiBlocking.beforeRequest();
      const detail = await fetchDetailPage(candidate.url);
      antiBlocking.onSuccess();

      if (detail === 'removed') {
        logger.info({ externalId: candidate.externalId, url: candidate.url }, 'OfferUp integration: listing removed');
        removedIds.push(candidate.externalId);
      } else if (detail) {
        enriched.push({
          ...candidate,
          description: detail.description || candidate.description,
          imageUrls: detail.imageUrls.length > 0 ? detail.imageUrls : candidate.imageUrls,
        });
      } else {
        enriched.push(candidate);
      }
    } catch (err) {
      antiBlocking.onError(err);
      logger.warn({ url: candidate.url, error: String(err) }, 'OfferUp integration: detail fetch failed');
      enriched.push(candidate);
    }
  }

  logger.info({ enriched: enriched.length, removed: removedIds.length }, 'OfferUp integration: enrichment complete');
  return { enriched, removedIds };
}

type DetailResult = {
  description: string;
  imageUrls: string[];
};

async function fetchDetailPage(url: string): Promise<DetailResult | 'removed' | null> {
  try {
    const res = await offerUpFetch(url);

    if (res.status === 404 || res.status === 410) return 'removed';
    if (!res.ok) return null;

    const html = await res.text();

    if (html.includes('no longer available') || html.includes('This item has been sold')) {
      return 'removed';
    }

    // Try __NEXT_DATA__ for structured data
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const listing = nextData?.props?.pageProps?.listing ??
                        nextData?.props?.pageProps?.item;
        if (listing) {
          const imageUrls: string[] = [];
          const photos = listing.photos ?? listing.images ?? [];
          for (const photo of photos.slice(0, 5)) {
            const photoUrl = photo.detail?.url ?? photo.url ?? (photo.uuid ? `https://images.offerup.com/${photo.uuid}/600x.jpg` : null);
            if (photoUrl) imageUrls.push(photoUrl);
          }
          return {
            description: listing.description ?? '',
            imageUrls,
          };
        }
      } catch {
        // Fall through to meta tags
      }
    }

    // Fallback: meta tags
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    const description = descMatch?.[1] ?? '';

    const imageUrls: string[] = [];
    const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (ogImageMatch) {
      imageUrls.push(ogImageMatch[1]);
    }

    return { description, imageUrls };
  } catch (err) {
    logger.warn({ url, error: String(err) }, 'OfferUp integration: detail page fetch failed');
    return null;
  }
}
