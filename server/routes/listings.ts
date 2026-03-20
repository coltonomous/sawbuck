import { Hono } from 'hono';
import { db } from '../db/index.js';
import { listings, listingImages } from '../db/schema.js';
import { eq, desc, asc, and, gte, lte, count, sql } from 'drizzle-orm';
import { analyzeListing } from '../analysis/vision.js';
import { downloadListingImages } from '../images/downloader.js';
import { processListingImages } from '../images/processor.js';
import { calculatePricing } from '../analysis/pricing.js';
import { fetchListingDetails } from '../scrapers/detail-fetcher.js';
import { getPrimaryImagePath } from '../lib/images.js';
import { updateListingSchema, bulkUpdateListingsSchema, importListingSchema } from '../lib/validation.js';
import { fingerprint } from '../scrapers/manager.js';
import type { Platform } from '../../shared/constants.js';

export const listingsRouter = new Hono();

// GET / — list listings with filters
listingsRouter.get('/', async (c) => {
  const { type, style, minScore, maxPrice, platform, status, page = '1', limit = '50', sort, sort_dir } = c.req.query();

  const conditions = [];
  if (type) conditions.push(eq(listings.furnitureType, type));
  if (style) conditions.push(eq(listings.furnitureStyle, style));
  if (minScore) conditions.push(gte(listings.dealScore, parseFloat(minScore)));
  if (maxPrice) conditions.push(lte(listings.askingPrice, parseFloat(maxPrice)));
  if (platform) conditions.push(eq(listings.platform, platform as 'craigslist' | 'offerup' | 'mercari' | 'ebay' | 'facebook'));
  if (status) conditions.push(eq(listings.status, status as 'new' | 'analyzed' | 'watching' | 'acquired' | 'dismissed'));

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Map sort key + direction to Drizzle order clause
  const dirFn = sort_dir === 'asc' ? asc : desc;
  const sortCol = sort === 'title' ? listings.title
    : sort === 'platform' ? listings.platform
    : sort === 'askingPrice' ? listings.askingPrice
    : sort === 'furnitureType' ? listings.furnitureType
    : sort === 'status' ? listings.status
    : sort === 'scrapedAt' ? listings.scrapedAt
    : sort === 'dealScore' ? listings.dealScore
    : null;
  const orderBy = sortCol ? dirFn(sortCol) : desc(listings.dealScore);

  const [results, countResult] = await Promise.all([
    db.select()
      .from(listings)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum),
    db.select({ total: count() })
      .from(listings)
      .where(whereClause),
  ]);

  const total = countResult[0]?.total ?? 0;

  const enriched = await Promise.all(results.map(async (listing) => ({
    ...listing,
    primaryImage: await getPrimaryImagePath(listing.id),
  })));

  return c.json({ listings: enriched, total });
});

// POST /import — import a listing by pasting its URL
listingsRouter.post('/import', async (c) => {
  const raw = await c.req.json();
  const parsed = importListingSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { url } = parsed.data;

  // Detect platform from URL
  const platformPatterns: { pattern: RegExp; platform: Platform; extractId: (url: string) => string | null }[] = [
    {
      pattern: /craigslist\.org/,
      platform: 'craigslist',
      extractId: (u) => u.match(/\/(\d+)\.html/)?.[1] ?? null,
    },
    {
      pattern: /offerup\.com/,
      platform: 'offerup',
      extractId: (u) => u.match(/\/item\/detail\/(\d+)/)?.[1] ?? u.match(/\/offer\/(\d+)/)?.[1] ?? null,
    },
    {
      pattern: /mercari\.com/,
      platform: 'mercari',
      extractId: (u) => u.match(/\/item\/(\w+)/)?.[1] ?? null,
    },
    {
      pattern: /ebay\.com/,
      platform: 'ebay',
      extractId: (u) => u.match(/\/itm\/(\d+)/)?.[1] ?? u.match(/\/itm\/[^/]+\/(\d+)/)?.[1] ?? null,
    },
    {
      pattern: /facebook\.com\/marketplace/,
      platform: 'facebook',
      extractId: (u) => u.match(/\/item\/(\d+)/)?.[1] ?? u.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null,
    },
  ];

  const match = platformPatterns.find((p) => p.pattern.test(url));
  if (!match) {
    return c.json({ error: 'Unsupported platform. Supported: Craigslist, OfferUp, Mercari, eBay, Facebook Marketplace.' }, 400);
  }

  const externalId = match.extractId(url);
  if (!externalId) {
    return c.json({ error: 'Could not extract listing ID from URL. Make sure this is a direct link to a listing.' }, 400);
  }

  // Check if already imported
  const existing = await db.select()
    .from(listings)
    .where(and(eq(listings.platform, match.platform), eq(listings.externalId, externalId)))
    .get();
  if (existing) {
    return c.json({ listing: existing, alreadyExists: true });
  }

  // Insert stub listing
  const [inserted] = await db.insert(listings).values({
    externalId,
    platform: match.platform,
    url,
    title: '(imported — loading details…)',
    matchedSearchTerms: JSON.stringify(['manual-import']),
    fingerprint: fingerprint({ externalId, platform: match.platform, url, title: '', imageUrls: [] }),
  }).returning();

  // Scrape the detail page to populate title, description, images, etc.
  try {
    await fetchListingDetails(inserted);
  } catch (err) {
    console.warn(`[import] Detail fetch failed for ${url}:`, err);
  }

  // Re-fetch the listing with updated data + images
  const listing = await db.select().from(listings).where(eq(listings.id, inserted.id)).get();
  const images = await db.select().from(listingImages).where(eq(listingImages.listingId, inserted.id));

  return c.json({ listing: { ...listing, images }, alreadyExists: false }, 201);
});

// GET /:id — single listing with images (auto-enriches if missing details)
listingsRouter.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));

  let listing = await db.select().from(listings).where(eq(listings.id, id)).get();
  if (!listing) return c.json({ error: 'Not found' }, 404);

  // Auto-fetch details if missing description, images, or description looks like a page dump
  const images = await db.select().from(listingImages).where(eq(listingImages.listingId, id));
  const badDescription = listing.description && (
    listing.description.includes('Skip to Make Offer') ||
    listing.description.includes('Skip to Save') ||
    listing.description.includes('Chat securely') ||
    listing.description.length > 2000
  );
  const badLocation = listing.location && (
    listing.location.includes('Skip') ||
    listing.location.includes('Chat securely') ||
    listing.location.includes('Similar items') ||
    listing.location.length > 100
  );
  const needsCleanup = badDescription || badLocation;
  if (needsCleanup) {
    const cleanupFields: Record<string, null> = {};
    if (badDescription) cleanupFields.description = null;
    if (badLocation) cleanupFields.location = null;
    await db.update(listings).set(cleanupFields).where(eq(listings.id, id));
    listing = (await db.select().from(listings).where(eq(listings.id, id)).get())!;
  }
  if (!listing.description || images.length === 0) {
    try {
      await fetchListingDetails(listing);
      listing = (await db.select().from(listings).where(eq(listings.id, id)).get())!;
      const updatedImages = await db.select().from(listingImages).where(eq(listingImages.listingId, id));
      return c.json({ ...listing, images: updatedImages });
    } catch (err) {
      console.warn(`[listings] Auto-enrich failed for ${id}:`, err);
    }
  }

  return c.json({ ...listing, images });
});

// PATCH /bulk — bulk update listings
listingsRouter.patch('/bulk', async (c) => {
  const raw = await c.req.json();
  const parsed = bulkUpdateListingsSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const { ids, updates } = parsed.data;

  for (const id of ids) {
    await db.update(listings).set(updates).where(eq(listings.id, id));
  }

  return c.json({ updated: ids.length });
});

// PATCH /:id — update listing
listingsRouter.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const raw = await c.req.json();
  const parsed = updateListingSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  await db.update(listings).set(parsed.data).where(eq(listings.id, id));
  const updated = await db.select().from(listings).where(eq(listings.id, id)).get();
  if (!updated) return c.json({ error: 'Not found' }, 404);

  return c.json(updated);
});

// POST /:id/analyze — kick off analysis in background, return 202
// The full pipeline (download → process → Claude → pricing) can exceed
// Cloudflare's 100s proxy timeout, so we run it async and let the
// frontend poll GET /:id until furnitureType is populated.
listingsRouter.post('/:id/analyze', async (c) => {
  const id = parseInt(c.req.param('id'));

  const listing = await db.select().from(listings).where(eq(listings.id, id)).get();
  if (!listing) return c.json({ error: 'Not found' }, 404);

  const apiKey = c.req.header('X-Anthropic-Key');

  // Fire and forget — results are persisted to DB
  (async () => {
    try {
      await downloadListingImages(id);
      await processListingImages(id);
      const analysis = await analyzeListing(id, apiKey);
      if (analysis) await calculatePricing(id);
    } catch (err) {
      console.error(`[analyze] Error analyzing listing ${id}:`, err);
    }
  })();

  return c.json({ status: 'analyzing' }, 202);
});

// GET /:id/price — get or calculate pricing
listingsRouter.get('/:id/price', async (c) => {
  const id = parseInt(c.req.param('id'));
  const pricing = await calculatePricing(id);
  if (!pricing) return c.json({ error: 'Could not calculate pricing' }, 422);
  return c.json(pricing);
});
