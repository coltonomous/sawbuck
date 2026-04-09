import { Hono } from 'hono';
import { db } from '../db/index.js';
import { listings, listingImages } from '../db/schema.js';
import { eq, desc, asc, and, or, gte, lte, count, sql } from 'drizzle-orm';
import { analyzeListing } from '../analysis/vision.js';
import { downloadListingImages } from '../images/downloader.js';
import { processListingImages } from '../images/processor.js';
import { calculatePricing } from '../analysis/pricing.js';
import { fetchListingDetails } from '../scrapers/detail-fetcher.js';
import { getPrimaryImagePath } from '../lib/images.js';
import { updateListingSchema, bulkUpdateListingsSchema, importListingSchema, createSawbuckListingSchema } from '../lib/validation.js';
import { parsePagination, buildOrderBy } from '../lib/pagination.js';
import { fingerprint } from '../scrapers/manager.js';
import logger from '../lib/logger.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { ORIGINALS_DIR } from '../lib/paths.js';
import type { Platform } from '../../shared/constants.js';

export const listingsRouter = new Hono();

// GET / — list listings with filters
listingsRouter.get('/', async (c) => {
  const user = c.get('user');
  const { type, style, minScore, maxPrice, platform, status, search } = c.req.query();
  const pagination = parsePagination(c);

  const conditions = [or(eq(listings.userId, user.id), eq(listings.platform, 'sawbuck'))!];
  if (type) conditions.push(eq(listings.furnitureType, type));
  if (style) conditions.push(eq(listings.furnitureStyle, style));
  if (minScore) conditions.push(gte(listings.dealScore, parseFloat(minScore)));
  if (maxPrice) conditions.push(lte(listings.askingPrice, parseFloat(maxPrice)));
  if (platform) conditions.push(eq(listings.platform, platform as 'craigslist' | 'offerup' | 'mercari' | 'ebay' | 'facebook' | 'sawbuck'));
  if (status) conditions.push(eq(listings.status, status as 'new' | 'analyzed' | 'watching' | 'acquired' | 'dismissed'));
  if (search || pagination.search) {
    const term = search || pagination.search!;
    conditions.push(sql`${listings.title} LIKE ${'%' + term + '%'}`);
  }

  const whereClause = and(...conditions);

  const sortColumns: Record<string, typeof listings.title> = {
    title: listings.title,
    platform: listings.platform,
    askingPrice: listings.askingPrice,
    furnitureType: listings.furnitureType,
    status: listings.status,
    scrapedAt: listings.scrapedAt,
    dealScore: listings.dealScore,
  };
  const orderBy = buildOrderBy(pagination, sortColumns, desc(listings.dealScore));

  const [results, countResult] = await Promise.all([
    db.select()
      .from(listings)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(pagination.limit)
      .offset(pagination.offset),
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
  const user = c.get('user');
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

  // Check if already imported by this user
  const existing = await db.select()
    .from(listings)
    .where(and(eq(listings.platform, match.platform), eq(listings.externalId, externalId), eq(listings.userId, user.id)))
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
    userId: user.id,
  }).returning();

  // Scrape the detail page to populate title, description, images, etc.
  try {
    await fetchListingDetails(inserted);
  } catch (err) {
    logger.warn({ err, url }, 'Detail fetch failed on import');
  }

  // Re-fetch the listing with updated data + images
  const listing = await db.select().from(listings).where(eq(listings.id, inserted.id)).get();
  const images = await db.select().from(listingImages).where(eq(listingImages.listingId, inserted.id));

  return c.json({ listing: { ...listing, images }, alreadyExists: false }, 201);
});

// POST /create — create a user-posted sawbuck listing (multipart with photos)
listingsRouter.post('/create', async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData();

  const title = formData.get('title') as string;
  const description = formData.get('description') as string | null;
  const askingPrice = parseFloat(formData.get('askingPrice') as string);
  const location = formData.get('location') as string | null;

  if (!title || title.length > 200) return c.json({ error: 'Title is required (max 200 chars)' }, 400);
  if (isNaN(askingPrice) || askingPrice < 0) return c.json({ error: 'Valid asking price is required' }, 400);

  const photos = formData.getAll('photos') as File[];
  if (photos.length === 0) return c.json({ error: 'At least one photo is required' }, 400);

  const externalId = crypto.randomUUID();
  const [inserted] = await db.insert(listings).values({
    externalId,
    platform: 'sawbuck',
    url: '',
    title,
    description: description || null,
    askingPrice,
    location: location || null,
    sellerName: user.name || user.email,
    scrapedAt: new Date().toISOString(),
    status: 'new',
    userId: user.id,
  }).returning();

  // Save photos to disk and create listingImages rows
  const imageDir = path.join(ORIGINALS_DIR, 'sawbuck', String(inserted.id));
  fs.mkdirSync(imageDir, { recursive: true });

  for (let i = 0; i < photos.length; i++) {
    const file = photos[i];
    const ext = path.extname(file.name) || '.jpg';
    const filename = `${i}${ext}`;
    const filePath = path.join(imageDir, filename);
    const relativePath = path.join('originals', 'sawbuck', String(inserted.id), filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    await db.insert(listingImages).values({
      listingId: inserted.id,
      sourceUrl: '',
      localPathOriginal: relativePath,
      downloadStatus: 'downloaded',
      isPrimary: i === 0,
    });
  }

  const images = await db.select().from(listingImages).where(eq(listingImages.listingId, inserted.id));
  return c.json({ listing: { ...inserted, images } }, 201);
});

// GET /:id — single listing with images (auto-enriches if missing details)
listingsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  let listing = await db.select().from(listings).where(and(eq(listings.id, id), or(eq(listings.userId, user.id), eq(listings.platform, 'sawbuck')))).get();
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
      logger.warn({ err, listingId: id }, 'Auto-enrich failed');
    }
  }

  return c.json({ ...listing, images });
});

// PATCH /bulk — bulk update listings
listingsRouter.patch('/bulk', async (c) => {
  const user = c.get('user');
  const raw = await c.req.json();
  const parsed = bulkUpdateListingsSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const { ids, updates } = parsed.data;

  for (const id of ids) {
    await db.update(listings).set(updates).where(and(eq(listings.id, id), eq(listings.userId, user.id)));
  }

  return c.json({ updated: ids.length });
});

// PATCH /:id — update listing
listingsRouter.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const raw = await c.req.json();
  const parsed = updateListingSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const existing = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.update(listings).set(parsed.data).where(and(eq(listings.id, id), eq(listings.userId, user.id)));
  const updated = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).get();

  return c.json(updated);
});

// DELETE /:id — delete a listing (owner only)
listingsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  const existing = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.delete(listingImages).where(eq(listingImages.listingId, id));
  await db.delete(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id)));

  return c.json({ ok: true });
});

// POST /:id/analyze — kick off analysis in background, return 202
listingsRouter.post('/:id/analyze', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  const listing = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).get();
  if (!listing) return c.json({ error: 'Not found' }, 404);

  // Fire and forget — results/errors are persisted to DB
  (async () => {
    try {
      await downloadListingImages(id);
      await processListingImages(id);
      const analysis = await analyzeListing(id);
      if (analysis) await calculatePricing(id);
    } catch (err: any) {
      const errorMsg = `Analysis failed: ${err?.message || 'Unknown error'}`;
      logger.error({ err, listingId: id }, 'Error analyzing listing');
      await db.update(listings).set({ analysisError: errorMsg }).where(eq(listings.id, id));
    }
  })();

  return c.json({ status: 'analyzing' }, 202);
});

// GET /:id/price — get or calculate pricing
listingsRouter.get('/:id/price', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  const listing = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).get();
  if (!listing) return c.json({ error: 'Not found' }, 404);

  const pricing = await calculatePricing(id);
  if (!pricing) return c.json({ error: 'Could not calculate pricing' }, 422);
  return c.json(pricing);
});
