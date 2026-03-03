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

export const listingsRouter = new Hono();

// GET / — list listings with filters
listingsRouter.get('/', async (c) => {
  const { type, style, minScore, maxPrice, platform, status, page = '1', limit = '50', sort, sort_dir } = c.req.query();

  const conditions = [];
  if (type) conditions.push(eq(listings.furnitureType, type));
  if (style) conditions.push(eq(listings.furnitureStyle, style));
  if (minScore) conditions.push(gte(listings.dealScore, parseFloat(minScore)));
  if (maxPrice) conditions.push(lte(listings.askingPrice, parseFloat(maxPrice)));
  if (platform) conditions.push(eq(listings.platform, platform as 'craigslist' | 'offerup' | 'mercari' | 'ebay'));
  if (status) conditions.push(eq(listings.status, status as any));

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
    const cleanupFields: Record<string, any> = {};
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
  const { ids, updates } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'ids array is required' }, 400);
  if (!updates || typeof updates !== 'object') return c.json({ error: 'updates object is required' }, 400);

  for (const id of ids) {
    await db.update(listings).set(updates).where(eq(listings.id, id));
  }

  return c.json({ updated: ids.length });
});

// PATCH /:id — update listing status
listingsRouter.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json();

  await db.update(listings).set(body).where(eq(listings.id, id));
  const updated = await db.select().from(listings).where(eq(listings.id, id)).get();

  return c.json(updated);
});

// POST /:id/analyze — download images, process, analyze with Claude, price
listingsRouter.post('/:id/analyze', async (c) => {
  const id = parseInt(c.req.param('id'));

  const listing = await db.select().from(listings).where(eq(listings.id, id)).get();
  if (!listing) return c.json({ error: 'Not found' }, 404);

  try {
    // Step 1: Download images if not done
    await downloadListingImages(id);

    // Step 2: Process images (resize + WebP)
    await processListingImages(id);

    // Step 3: Claude Vision analysis
    const analysis = await analyzeListing(id);
    if (!analysis) {
      return c.json({ error: 'Analysis failed — no usable images or parse error' }, 422);
    }

    // Step 4: Price estimation
    const pricing = await calculatePricing(id);

    // Return updated listing
    const updated = await db.select().from(listings).where(eq(listings.id, id)).get();
    const images = await db.select().from(listingImages).where(eq(listingImages.listingId, id));

    return c.json({ ...updated, images, analysis, pricing });
  } catch (err: any) {
    console.error(`[analyze] Error analyzing listing ${id}:`, err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /:id/price — get or calculate pricing
listingsRouter.get('/:id/price', async (c) => {
  const id = parseInt(c.req.param('id'));
  const pricing = await calculatePricing(id);
  if (!pricing) return c.json({ error: 'Could not calculate pricing' }, 422);
  return c.json(pricing);
});
