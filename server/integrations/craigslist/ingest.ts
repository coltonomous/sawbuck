import { db } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { agentConfig } from '../../agents/config.js';
import { AntiBlockingController } from '../../agents/anti-blocking.js';
import { clFetch, warmCookies } from './client.js';
import type { ScrapedCandidate } from '../common/types.js';
import logger from '../../lib/logger.js';

const SEARCH_URL = (city: string, page = 0) =>
  `https://${city}.craigslist.org/search/fua#search=1~list~${page}~0`;

// Extract external ID from CL URL: .../12345.html → 12345
function extractId(url: string): string {
  const match = url.match(/\/(\d+)\.html/);
  return match?.[1] ?? url;
}

interface JsonLdItem {
  name: string;
  description?: string;
  image?: string[];
  offers?: {
    price?: string;
    availableAtOrFrom?: {
      address?: { addressLocality?: string };
      geo?: { latitude?: number; longitude?: number };
    };
  };
}

/**
 * Parse the JSON-LD structured data and listing URLs from a CL search page.
 * CL embeds a full schema.org ItemList in a <script id="ld_searchpage_results">.
 * Listing URLs are extracted from <a> tags separately and matched by position.
 */
function parseSearchPage(html: string): Array<{
  title: string;
  url: string;
  externalId: string;
  askingPrice: number | null;
  location: string;
  latitude?: number;
  longitude?: number;
  imageUrls: string[];
  description?: string;
}> {
  // Extract JSON-LD
  const ldMatch = html.match(/id="ld_searchpage_results"[^>]*>([\s\S]*?)<\/script>/);
  if (!ldMatch) {
    logger.warn('CL integration: no JSON-LD found in search page');
    return [];
  }

  let items: Array<{ item: JsonLdItem }>;
  try {
    const data = JSON.parse(ldMatch[1]);
    items = data.itemListElement ?? [];
  } catch {
    logger.error('CL integration: failed to parse JSON-LD');
    return [];
  }

  // Extract listing URLs from HTML (ordered same as JSON-LD)
  const urlMatches = html.matchAll(/href="(https:\/\/[^"]+\.craigslist\.org\/[^"]+\/(\d+)\.html)"/g);
  const urls: string[] = [];
  const seenUrls = new Set<string>();
  for (const m of urlMatches) {
    if (!seenUrls.has(m[1])) {
      seenUrls.add(m[1]);
      urls.push(m[1]);
    }
  }

  const results = [];
  for (let i = 0; i < items.length && i < urls.length; i++) {
    const ld = items[i].item;
    const url = urls[i];
    const externalId = extractId(url);

    const price = ld.offers?.price ? parseFloat(ld.offers.price) : null;
    const geo = ld.offers?.availableAtOrFrom?.geo;
    const locality = ld.offers?.availableAtOrFrom?.address?.addressLocality || '';

    results.push({
      title: ld.name || '',
      url,
      externalId,
      askingPrice: price && !isNaN(price) ? price : null,
      location: locality,
      latitude: geo?.latitude,
      longitude: geo?.longitude,
      imageUrls: (ld.image ?? []).slice(0, 3),
      description: ld.description || undefined,
    });
  }

  return results;
}

/**
 * Phase 1: Discover new listings from CL search page.
 * Parses JSON-LD structured data embedded in HTML — no RSS needed.
 */
export async function discover(page = 0): Promise<ScrapedCandidate[]> {
  const city = agentConfig.targetCity;

  // Warm cookies on first request to establish a session
  await warmCookies(city);

  const searchUrl = SEARCH_URL(city, page);
  logger.info({ searchUrl, page }, 'CL integration: fetching search page');

  const res = await clFetch(searchUrl, {
    referer: `https://${city}.craigslist.org/`,
  });

  if (!res.ok) {
    throw new Error(`CL search page returned ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const parsed = parseSearchPage(html);

  logger.info({ count: parsed.length }, 'CL integration: search items parsed');

  if (parsed.length === 0) return [];

  // Dedup against DB
  const externalIds = parsed.map((item) => item.externalId);
  const existing = await db
    .select({ externalId: listings.externalId })
    .from(listings)
    .where(and(eq(listings.platform, 'craigslist'), inArray(listings.externalId, externalIds)));
  const existingIds = new Set(existing.map((e) => e.externalId));

  const newItems = parsed.filter((item) => !existingIds.has(item.externalId));
  logger.info({ total: parsed.length, new: newItems.length, existing: existingIds.size }, 'CL integration: dedup results');

  return newItems.map((item) => ({
    externalId: item.externalId,
    url: item.url,
    title: item.title,
    askingPrice: item.askingPrice,
    location: item.location || city,
    latitude: item.latitude,
    longitude: item.longitude,
    imageUrls: item.imageUrls,
    description: item.description,
  }));
}

export interface EnrichResult {
  enriched: ScrapedCandidate[];
  removedIds: string[]; // externalIds of listings confirmed gone (404)
}

/**
 * Phase 2: Enrich candidates that passed triage with full detail page data.
 * Fetches individual listing pages for descriptions, images, and lat/lng.
 * Listings that return 404 are flagged as removed.
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
        logger.info({ externalId: candidate.externalId, url: candidate.url }, 'CL integration: listing removed (404)');
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
        enriched.push(candidate); // keep search data on non-404 failure
      }
    } catch (err) {
      antiBlocking.onError(err);
      logger.warn({ url: candidate.url, error: String(err) }, 'CL integration: detail fetch failed');
      enriched.push(candidate); // keep search data on failure
    }
  }

  logger.info({ enriched: enriched.length, removed: removedIds.length }, 'CL integration: enrichment complete');
  return { enriched, removedIds };
}

type DetailResult = {
  description: string;
  imageUrls: string[];
  latitude?: number;
  longitude?: number;
};

async function fetchDetailPage(url: string): Promise<DetailResult | 'removed' | null> {
  try {
    const res = await clFetch(url, {
      referer: `https://${new URL(url).hostname}/search/fua`,
    });

    if (res.status === 404) return 'removed';
    if (!res.ok) return null;

    const html = await res.text();

    // CL sometimes returns 200 with a deletion notice instead of 404
    if (html.includes('This posting has been deleted') || html.includes('This posting has expired')) {
      return 'removed';
    }

    const descMatch = html.match(/<section id="postingbody"[^>]*>([\s\S]*?)<\/section>/i);
    let description = '';
    if (descMatch) {
      description = descMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/QR Code Link to This Post\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Match any CL image URL pattern, normalize to 600x450
    const imageUrls: string[] = [];
    const imgRegex = /https:\/\/images\.craigslist\.org\/[a-zA-Z0-9_]+_\d+x\d+\.\w+/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const normalized = imgMatch[0].replace(/_\d+x\d+\./, '_600x450.');
      if (!imageUrls.includes(normalized)) {
        imageUrls.push(normalized);
      }
    }

    // Extract and validate lat/lng
    let latitude: number | undefined;
    let longitude: number | undefined;
    const latMatch = html.match(/data-latitude="([^"]+)"/);
    const lngMatch = html.match(/data-longitude="([^"]+)"/);
    if (latMatch && lngMatch) {
      const lat = parseFloat(latMatch[1]);
      const lng = parseFloat(lngMatch[1]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        latitude = lat;
        longitude = lng;
      }
    }

    return { description, imageUrls, latitude, longitude };
  } catch (err) {
    logger.warn({ url, error: String(err) }, 'CL integration: detail page fetch failed');
    return null;
  }
}
