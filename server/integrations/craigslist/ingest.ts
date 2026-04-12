import { XMLParser } from 'fast-xml-parser';
import { db } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { agentConfig } from '../../agents/config.js';
import { AntiBlockingController } from '../../agents/anti-blocking.js';
import type { ScrapedCandidate } from '../common/types.js';
import logger from '../../lib/logger.js';

const RSS_URL = (city: string, offset = 0) => `https://${city}.craigslist.org/search/fua?format=rss&s=${offset}`;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

// Parse price and location from CL title format: "Title - $Price (Location)"
function parseTitlePriceLoc(raw: string): { title: string; price: number | null; neighborhood: string } {
  let title = raw;
  let price: number | null = null;
  let neighborhood = '';

  // Extract neighborhood from end: "... (Capitol Hill)"
  const locMatch = title.match(/\s*\(([^)]+)\)\s*$/);
  if (locMatch) {
    neighborhood = locMatch[1];
    title = title.slice(0, locMatch.index!).trim();
  }

  // Extract price: "... - $150" or "$150"
  const priceMatch = title.match(/\s*[-–]\s*\$([0-9,]+)\s*$/);
  if (priceMatch) {
    price = parseFloat(priceMatch[1].replace(/,/g, ''));
    title = title.slice(0, priceMatch.index!).trim();
  }

  return { title, price, neighborhood };
}

interface RssItem {
  title: string;
  link: string;
  description: string;
  date: string;
  imageUrl: string | null;
}

function parseRssItems(xml: string): RssItem[] {
  try {
    const parsed = xmlParser.parse(xml);

    // CL uses RDF format: rdf:RDF > item[]
    const rdf = parsed['rdf:RDF'] || parsed.rdf || parsed;
    const rawItems = rdf?.item;
    if (!rawItems) return [];

    const itemArray = Array.isArray(rawItems) ? rawItems : [rawItems];

    return itemArray
      .map((item: any): RssItem | null => {
        const title = typeof item.title === 'string' ? item.title : String(item.title ?? '');
        const link = typeof item.link === 'string' ? item.link : String(item.link ?? '');
        if (!title || !link) return null;

        const description = typeof item.description === 'string' ? item.description : '';
        const date = item['dc:date'] || '';
        const enclosure = item['enc:enclosure'];
        const imageUrl = enclosure?.['@_resource'] || null;

        return { title, link, description, date, imageUrl };
      })
      .filter((item): item is RssItem => item !== null);
  } catch (err) {
    logger.error({ error: String(err) }, 'CL integration: RSS XML parse failed');
    return [];
  }
}

// Extract external ID from CL URL: .../12345.html → 12345
function extractId(url: string): string {
  const match = url.match(/\/(\d+)\.html/);
  return match?.[1] ?? url;
}

/**
 * Phase 1: Discover new listings from RSS feed.
 * Returns lightweight candidates (title, price, location, RSS description snippet).
 * No detail page fetches — just RSS data for triage.
 */
export async function discover(offset = 0): Promise<ScrapedCandidate[]> {
  const city = agentConfig.targetCity;
  const rssUrl = RSS_URL(city, offset);

  logger.info({ rssUrl, offset }, 'CL integration: fetching RSS feed');

  const res = await fetch(rssUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`CL RSS feed returned ${res.status}: ${res.statusText}`);
  }

  const xml = await res.text();
  const rssItems = parseRssItems(xml);

  logger.info({ count: rssItems.length }, 'CL integration: RSS items parsed');

  if (rssItems.length === 0) return [];

  // Dedup against DB
  const externalIds = rssItems.map((item) => extractId(item.link));
  const existing = await db
    .select({ externalId: listings.externalId })
    .from(listings)
    .where(and(eq(listings.platform, 'craigslist'), inArray(listings.externalId, externalIds)));
  const existingIds = new Set(existing.map((e) => e.externalId));

  const newItems = rssItems.filter((item) => !existingIds.has(extractId(item.link)));
  logger.info({ total: rssItems.length, new: newItems.length, existing: existingIds.size }, 'CL integration: dedup results');

  return newItems.map((item) => {
    const { title, price, neighborhood } = parseTitlePriceLoc(item.title);
    return {
      externalId: extractId(item.link),
      url: item.link,
      title,
      askingPrice: price,
      location: neighborhood || city,
      imageUrls: item.imageUrl ? [item.imageUrl] : [],
      description: item.description || undefined,
      postedAt: item.date || undefined,
    };
  });
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
        enriched.push(candidate); // keep RSS data on non-404 failure
      }
    } catch (err) {
      antiBlocking.onError(err);
      logger.warn({ url: candidate.url, error: String(err) }, 'CL integration: detail fetch failed');
      enriched.push(candidate); // keep RSS data on failure
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
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
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
