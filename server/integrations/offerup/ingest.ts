import { db } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { agentConfig } from '../../agents/config.js';
import { AntiBlockingController } from '../../agents/anti-blocking.js';
import { offerUpFetch, warmCookies } from './client.js';
import type { ScrapedCandidate, Region, EnrichResult } from '../common/types.js';
import logger from '../../lib/logger.js';

// Rotate search queries to cover more furniture types across runs.
// OfferUp's keyword search is noisy, so specific terms reduce junk.
const SEARCH_QUERIES = [
  'wood dresser',
  'wood desk',
  'wood bookcase',
  'wood cabinet',
  'dining table wood',
  'coffee table wood',
  'wood nightstand',
  'wood hutch buffet',
  'wood armoire',
  'vintage furniture',
  'mid century modern furniture',
  'solid wood furniture',
  'antique furniture',
  'wood bench',
  'wood console table',
  'wood vanity',
  'wood bed frame',
  'wood shelf',
  'wood end table',
  'farmhouse furniture',
];

// GraphQL query for OfferUp's modular feed endpoint.
// Calling the API directly bypasses SSR, which falls back to server IP
// geolocation (Kansas) and ignores URL/cookie location params.
const MODULAR_FEED_QUERY = `
query GetModularFeed($searchParams: [SearchParam]) {
  modularFeed(params: $searchParams) {
    looseTiles {
      ...modularTileListing
    }
  }
}

fragment modularTileListing on ModularFeedTileListing {
  tileId
  listing {
    listingId
    conditionText
    image {
      height
      url
      width
    }
    locationName
    price
    title
  }
  tileType
}
`;

interface GraphQLTile {
  tileType?: string;
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
 * Search OfferUp via their GraphQL API with explicit lat/lon.
 * This avoids the SSR HTML path which ignores location params and
 * falls back to IP geolocation (resolving cloud IPs to Kansas).
 */
async function searchGraphQL(region: Region, query: string): Promise<Array<{
  externalId: string;
  title: string;
  askingPrice: number | null;
  location: string;
  imageUrl: string | null;
}>> {
  const searchParams = [
    { key: 'q', value: query },
    { key: 'lat', value: String(region.latitude) },
    { key: 'lon', value: String(region.longitude) },
    { key: 'distance', value: String(region.radiusMiles) },
    { key: 'delivery_param', value: 'all' },
    { key: 'platform', value: 'web' },
  ];

  const body = JSON.stringify({
    query: MODULAR_FEED_QUERY,
    variables: { searchParams },
  });

  const res = await offerUpFetch('https://offerup.com/api/graphql', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    logger.warn({ status: res.status, query }, 'OfferUp GraphQL returned non-200');
    return [];
  }

  let tiles: GraphQLTile[];
  try {
    const json = await res.json() as { data?: { modularFeed?: { looseTiles?: GraphQLTile[] } } };
    tiles = json?.data?.modularFeed?.looseTiles ?? [];
  } catch {
    logger.error({ query }, 'OfferUp GraphQL: failed to parse response');
    return [];
  }

  const results = [];
  for (const tile of tiles) {
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
 * Phase 1: Discover new listings from OfferUp via GraphQL API.
 * Calls the API directly with lat/lon so location is always correct
 * (the SSR HTML path falls back to IP geolocation → Kansas).
 */
export async function discover(region: Region, _page = 0): Promise<ScrapedCandidate[]> {
  await warmCookies({ latitude: region.latitude, longitude: region.longitude, radiusMiles: region.radiusMiles, name: region.name });

  const allParsed: Array<{ externalId: string; title: string; askingPrice: number | null; location: string; imageUrl: string | null }> = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    const query = SEARCH_QUERIES[i];
    logger.info({ query, region: region.name }, 'OfferUp integration: searching via GraphQL API');

    try {
      const parsed = await searchGraphQL(region, query);
      for (const item of parsed) {
        if (!seenIds.has(item.externalId)) {
          seenIds.add(item.externalId);
          allParsed.push(item);
        }
      }
    } catch (err) {
      logger.warn({ query, error: String(err) }, 'OfferUp search fetch failed');
    }

    // Brief delay between queries to avoid rate limiting
    if (i < SEARCH_QUERIES.length - 1) {
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    }
  }

  logger.info({ count: allParsed.length, queries: SEARCH_QUERIES.length, region: region.name }, 'OfferUp integration: search items parsed');

  if (allParsed.length === 0) return [];

  // Dedup against DB
  const externalIds = allParsed.map((item) => item.externalId);
  const existing = await db
    .select({ externalId: listings.externalId })
    .from(listings)
    .where(and(eq(listings.platform, 'offerup'), inArray(listings.externalId, externalIds)));
  const existingIds = new Set(existing.map((e) => e.externalId));

  const newItems = allParsed.filter((item) => !existingIds.has(item.externalId));
  logger.info({ total: allParsed.length, new: newItems.length, existing: existingIds.size }, 'OfferUp integration: dedup results');

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
          latitude: detail.latitude ?? candidate.latitude,
          longitude: detail.longitude ?? candidate.longitude,
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
  latitude?: number;
  longitude?: number;
};

// OfferUp's rendered pages and meta tags prefix descriptions with a
// "Make an offer on ..." call-to-action that isn't part of the seller's text.
function stripOfferUpBoilerplate(description: string): string {
  let cleaned = description
    .replace(/^\s*Make an? (?:Offer|offer)\s+on\b[^.!\n]*[.!\n]?\s*/g, '')
    .replace(/\bMake an? (?:Offer|offer)\b[.!]?\s*/g, '')
    .trim()
    .replace(/;+\s*$/, '');
  return cleaned;
}

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

          // Extract lat/lng from listing location data.
          // OfferUp's __NEXT_DATA__ may nest coordinates in a location object
          // or place them directly on the listing — check both patterns.
          let latitude: number | undefined;
          let longitude: number | undefined;
          const loc = listing.location ?? listing.locationDetails ?? listing.geoLocation;
          const latRaw = loc?.latitude ?? loc?.lat ?? listing.latitude ?? listing.lat;
          const lngRaw = loc?.longitude ?? loc?.lng ?? loc?.lon ?? listing.longitude ?? listing.lng;
          if (latRaw != null && lngRaw != null) {
            const lat = parseFloat(latRaw);
            const lng = parseFloat(lngRaw);
            if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
              latitude = lat;
              longitude = lng;
            }
          }

          return {
            description: stripOfferUpBoilerplate(listing.description ?? ''),
            imageUrls,
            latitude,
            longitude,
          };
        }
      } catch {
        // Fall through to meta tags
      }
    }

    // Fallback: meta tags
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    const description = stripOfferUpBoilerplate(descMatch?.[1] ?? '');

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
