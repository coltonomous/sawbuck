import { db } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { agentConfig } from '../../agents/config.js';
import { AntiBlockingController } from '../../agents/anti-blocking.js';
import { offerUpFetch, warmCookies } from './client.js';
import type { ScrapedCandidate, Region, EnrichResult } from '../common/types.js';
import logger from '../../lib/logger.js';

const SEARCH_API = 'https://offerup.com/api/search/v4/search';
const ITEMS_PER_PAGE = 25;

interface OfferUpListing {
  id: string;
  title: string;
  price: string | number;
  images?: Array<{ uuid: string; url?: string }>;
  location?: {
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  description?: string;
  post_date_ago?: string;
  detail_url?: string;
  condition?: string;
  get_url?: string;
}

interface OfferUpSearchResponse {
  data?: {
    feed_items?: Array<{
      listing?: OfferUpListing;
    }>;
  };
}

/**
 * Phase 1: Discover new listings from OfferUp search API.
 * Uses lat/lng + radius from the region config.
 */
export async function discover(region: Region, page = 0): Promise<ScrapedCandidate[]> {
  await warmCookies();

  const params = new URLSearchParams({
    platform: 'web',
    experiment_id: '',
    q: 'wood furniture',
    radius: String(region.radiusMiles),
    lat: String(region.latitude),
    lon: String(region.longitude),
    limit: String(ITEMS_PER_PAGE),
    offset: String(page * ITEMS_PER_PAGE),
    sort: '-posted',
    delivery: 'all',
  });

  const searchUrl = `${SEARCH_API}?${params}`;
  logger.info({ searchUrl, page, region: region.name }, 'OfferUp integration: fetching search results');

  const res = await offerUpFetch(searchUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`OfferUp search API returned ${res.status}: ${res.statusText}`);
  }

  const json: OfferUpSearchResponse = await res.json();
  const feedItems = json.data?.feed_items ?? [];

  const parsed: ScrapedCandidate[] = [];
  for (const item of feedItems) {
    const listing = item.listing;
    if (!listing?.id || !listing?.title) continue;

    const price = typeof listing.price === 'string' ? parseFloat(listing.price) : listing.price;
    const imageUrls: string[] = [];
    if (listing.images) {
      for (const img of listing.images.slice(0, 3)) {
        if (img.url) {
          imageUrls.push(img.url);
        } else if (img.uuid) {
          imageUrls.push(`https://images.offerup.com/${img.uuid}/600x.jpg`);
        }
      }
    }

    const listingUrl = listing.get_url
      ? `https://offerup.com${listing.get_url}`
      : `https://offerup.com/item/detail/${listing.id}`;

    parsed.push({
      externalId: String(listing.id),
      platform: 'offerup',
      url: listingUrl,
      title: listing.title,
      askingPrice: !isNaN(price) ? price : null,
      location: listing.location?.city || region.name,
      latitude: listing.location?.latitude,
      longitude: listing.location?.longitude,
      imageUrls,
      description: listing.description,
    });
  }

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

  return newItems;
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

    // OfferUp returns 200 with "no longer available" for removed listings
    if (html.includes('no longer available') || html.includes('This item has been sold')) {
      return 'removed';
    }

    // Try to extract __NEXT_DATA__ JSON for structured data
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
            const url = photo.detail?.url ?? photo.url ?? (photo.uuid ? `https://images.offerup.com/${photo.uuid}/600x.jpg` : null);
            if (url) imageUrls.push(url);
          }
          return {
            description: listing.description ?? '',
            imageUrls,
          };
        }
      } catch {
        // Fall through to HTML parsing
      }
    }

    // Fallback: extract from meta tags
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
