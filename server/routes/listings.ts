import { Hono } from 'hono';
import { db } from '../db/index.js';
import { listings, listingImages, conceptRenders, users } from '../db/schema.js';
import { eq, ne, desc, asc, and, or, gte, lte, count, sql, isNull } from 'drizzle-orm';
import { analyzeListing } from '../analysis/vision.js';
import { downloadListingImages } from '../images/downloader.js';
import { processListingImages } from '../images/processor.js';
import { calculatePricing } from '../analysis/pricing.js';
import { getPrimaryImagePath, getPrimaryImagePaths } from '../lib/images.js';
import { updateListingSchema, bulkUpdateListingsSchema, importListingSchema, createSawbuckListingSchema, editSawbuckListingSchema } from '../lib/validation.js';
import { parsePagination, buildOrderBy } from '../lib/pagination.js';
import { fingerprint } from '../lib/fingerprint.js';
import logger from '../lib/logger.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { ORIGINALS_DIR, IMAGES_DIR } from '../lib/paths.js';
import { validateUpload, UploadError } from '../lib/upload.js';
import { inArray } from 'drizzle-orm';
import type { Platform } from '../../shared/constants.js';

export const listingsRouter = new Hono();

// GET / — list listings with filters
listingsRouter.get('/', async (c) => {
  const user = c.get('user');
  const { type, style, minScore, maxPrice, platform, status, search, mine } = c.req.query();
  const pagination = parsePagination(c);

  const conditions = mine
    ? [and(eq(listings.userId, user.id), eq(listings.platform, 'sawbuck'))!]
    : [or(
        // User's own scraped listings (non-sawbuck)
        and(eq(listings.userId, user.id), sql`${listings.platform} != 'sawbuck'`),
        // Community sawbuck listings from other users
        and(sql`${listings.platform} = 'sawbuck'`, sql`${listings.userId} != ${user.id}`),
        // Agent-discovered listings (userId IS NULL)
        isNull(listings.userId),
      )!];

  // Apply user preference filters to agent-discovered listings only
  // (user's own listings are always shown regardless of preferences)
  const userPrefs = await db.select({
    maxBudget: users.maxBudget,
    preferredLatitude: users.preferredLatitude,
    preferredLongitude: users.preferredLongitude,
    preferredRadiusMiles: users.preferredRadiusMiles,
    shopSpace: users.shopSpace,
    experienceLevel: users.experienceLevel,
    stylePreferences: users.stylePreferences,
  }).from(users).where(eq(users.id, user.id)).then(r => r[0]);

  if (!mine && userPrefs) {
    if (userPrefs.maxBudget) {
      conditions.push(
        or(
          sql`${listings.userId} IS NOT NULL`,
          lte(listings.askingPrice, userPrefs.maxBudget),
          isNull(listings.askingPrice),
        )!,
      );
    }

    if (userPrefs.preferredLatitude && userPrefs.preferredLongitude && userPrefs.preferredRadiusMiles) {
      conditions.push(
        or(
          sql`${listings.userId} IS NOT NULL`,
          isNull(listings.latitude),
          sql`(3959 * acos(cos(radians(${userPrefs.preferredLatitude})) * cos(radians(${listings.latitude})) * cos(radians(${listings.longitude}) - radians(${userPrefs.preferredLongitude})) + sin(radians(${userPrefs.preferredLatitude})) * sin(radians(${listings.latitude})))) <= ${userPrefs.preferredRadiusMiles}`,
        )!,
      );
    }

    if (userPrefs.shopSpace === 'small_workshop') {
      conditions.push(
        or(
          sql`${listings.userId} IS NOT NULL`,
          sql`${listings.furnitureType} NOT IN ('sofa', 'sectional', 'dining_table', 'bed_frame')`,
          isNull(listings.furnitureType),
        )!,
      );
    }

    if (userPrefs.experienceLevel === 'beginner') {
      conditions.push(
        or(
          sql`${listings.userId} IS NOT NULL`,
          gte(listings.conditionScore, 5),
          isNull(listings.conditionScore),
        )!,
      );
    }

    if (userPrefs.stylePreferences) {
      try {
        const styles = JSON.parse(userPrefs.stylePreferences) as string[];
        if (styles.length > 0) {
          const styleConditions = styles.map((s) => sql`${listings.furnitureStyle} LIKE ${'%' + s + '%'}`);
          conditions.push(
            or(
              sql`${listings.userId} IS NOT NULL`,
              isNull(listings.furnitureStyle),
              or(...styleConditions)!,
            )!,
          );
        }
      } catch {
        // invalid JSON, skip style filtering
      }
    }
  }
  if (type) conditions.push(eq(listings.furnitureType, type));
  if (style) conditions.push(eq(listings.furnitureStyle, style));
  if (minScore) conditions.push(gte(listings.dealScore, parseFloat(minScore)));
  if (maxPrice) conditions.push(lte(listings.askingPrice, parseFloat(maxPrice)));
  if (platform) conditions.push(eq(listings.platform, platform as 'craigslist' | 'offerup' | 'ebay' | 'sawbuck'));
  if (status) {
    conditions.push(eq(listings.status, status as 'new' | 'analyzed' | 'watching' | 'acquired' | 'dismissed' | 'removed'));
  } else {
    // Exclude removed listings from the default feed
    conditions.push(ne(listings.status, 'removed'));
  }
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

  // Batch-load concept renders for agent listings
  const agentListingIds = results.filter((l) => l.userId === null).map((l) => l.id);
  const conceptMap = new Map<number, Array<{
    difficulty: string;
    label: string;
    summary: string;
    estimatedHours: number | null;
    estimatedMaterialCost: number | null;
    estimatedResalePrice: number | null;
    localPath: string;
  }>>();
  if (agentListingIds.length > 0) {
    const renders = await db.select({
      listingId: conceptRenders.listingId,
      difficulty: conceptRenders.difficulty,
      label: conceptRenders.label,
      summary: conceptRenders.summary,
      estimatedHours: conceptRenders.estimatedHours,
      estimatedMaterialCost: conceptRenders.estimatedMaterialCost,
      estimatedResalePrice: conceptRenders.estimatedResalePrice,
      localPath: conceptRenders.localPath,
    })
      .from(conceptRenders)
      .where(sql`${conceptRenders.listingId} IN (${sql.join(agentListingIds.map(id => sql`${id}`), sql`, `)})`)
      ;
    for (const r of renders) {
      if (r.localPath) {
        if (!conceptMap.has(r.listingId)) conceptMap.set(r.listingId, []);
        conceptMap.get(r.listingId)!.push({
          difficulty: r.difficulty,
          label: r.label,
          summary: r.summary,
          estimatedHours: r.estimatedHours,
          estimatedMaterialCost: r.estimatedMaterialCost,
          estimatedResalePrice: r.estimatedResalePrice,
          localPath: r.localPath,
        });
      }
    }
  }

  // Batch-load primary images (1 query instead of N)
  const primaryImages = await getPrimaryImagePaths(results.map((l) => l.id));

  const enriched = results.map((listing) => ({
    ...listing,
    primaryImage: primaryImages.get(listing.id) ?? null,
    conceptImages: conceptMap.get(listing.id) ?? null,
  }));

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
      pattern: /ebay\.com/,
      platform: 'ebay',
      extractId: (u) => u.match(/\/itm\/(\d+)/)?.[1] ?? u.match(/\/itm\/[^/]+\/(\d+)/)?.[1] ?? null,
    },
  ];

  const match = platformPatterns.find((p) => p.pattern.test(url));
  if (!match) {
    return c.json({ error: 'Unsupported platform. Supported: Craigslist, OfferUp, Mercari, eBay.' }, 400);
  }

  const externalId = match.extractId(url);
  if (!externalId) {
    return c.json({ error: 'Could not extract listing ID from URL. Make sure this is a direct link to a listing.' }, 400);
  }

  // Check if already imported by this user
  const existing = await db.select()
    .from(listings)
    .where(and(eq(listings.platform, match.platform), eq(listings.externalId, externalId), eq(listings.userId, user.id)))
    .then(r => r[0]);
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
    fingerprint: fingerprint({ externalId, platform: match.platform, title: '' }),
    userId: user.id,
  }).returning();

  // Re-fetch the listing with updated data + images
  const listing = await db.select().from(listings).where(eq(listings.id, inserted.id)).then(r => r[0]);
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
  if (photos.length > 10) return c.json({ error: 'Maximum 10 photos allowed' }, 400);

  // Validate all uploads before creating the listing
  const validated = [];
  for (const file of photos) {
    try {
      validated.push(await validateUpload(file));
    } catch (err) {
      if (err instanceof UploadError) return c.json({ error: err.message }, 400);
      throw err;
    }
  }

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
    scrapedAt: new Date(),
    status: 'new',
    userId: user.id,
  }).returning();

  // Save photos to disk and create listingImages rows
  const imageDir = path.join(ORIGINALS_DIR, 'sawbuck', String(inserted.id));
  await fs.mkdir(imageDir, { recursive: true });

  for (let i = 0; i < validated.length; i++) {
    const { buffer, ext } = validated[i];
    const filename = `${i}${ext}`;
    const filePath = path.join(imageDir, filename);
    const relativePath = path.join('originals', 'sawbuck', String(inserted.id), filename);

    await fs.writeFile(filePath, buffer);

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

// PATCH /create/:id — edit a user-posted sawbuck listing
listingsRouter.patch('/create/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const raw = await c.req.json();
  const parsed = editSawbuckListingSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const existing = await db.select().from(listings).where(
    and(eq(listings.id, id), eq(listings.userId, user.id), eq(listings.platform, 'sawbuck'))
  ).then(r => r[0]);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.update(listings).set(parsed.data).where(and(eq(listings.id, id), eq(listings.userId, user.id)));
  const updated = await db.select().from(listings).where(eq(listings.id, id)).then(r => r[0]);
  return c.json(updated);
});

// GET /:id — single listing with images (auto-enriches if missing details)
listingsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  // Visible: user's own, any sawbuck listing, or agent-discovered (userId IS NULL)
  let listing = await db.select().from(listings).where(and(eq(listings.id, id), or(eq(listings.userId, user.id), eq(listings.platform, 'sawbuck'), isNull(listings.userId)))).then(r => r[0]);
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
    listing = (await db.select().from(listings).where(eq(listings.id, id)).then(r => r[0]))!;
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

  const result = await db.transaction(async (tx) => {
    return tx.update(listings)
      .set(updates)
      .where(and(inArray(listings.id, ids), eq(listings.userId, user.id)));
  });

  return c.json({ updated: result.rowCount ?? 0 });
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

  const existing = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).then(r => r[0]);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.update(listings).set(parsed.data).where(and(eq(listings.id, id), eq(listings.userId, user.id)));
  const updated = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).then(r => r[0]);

  return c.json(updated);
});

// DELETE /:id — delete a listing (owner only)
listingsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  const existing = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).then(r => r[0]);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Delete image files from disk before removing DB records
  const images = await db.select().from(listingImages).where(eq(listingImages.listingId, id));
  for (const img of images) {
    if (img.localPathOriginal) await fs.unlink(path.join(IMAGES_DIR, img.localPathOriginal)).catch(() => {});
    if (img.localPathResized) await fs.unlink(path.join(IMAGES_DIR, img.localPathResized)).catch(() => {});
  }

  await db.delete(listingImages).where(eq(listingImages.listingId, id));
  await db.delete(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id)));

  return c.json({ ok: true });
});

// POST /:id/analyze — kick off analysis in background, return 202
listingsRouter.post('/:id/analyze', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  // Allow analysis of own listings + any sawbuck listing
  const listing = await db.select().from(listings).where(
    and(eq(listings.id, id), or(eq(listings.userId, user.id), eq(listings.platform, 'sawbuck')))
  ).then(r => r[0]);
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

  const listing = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, user.id))).then(r => r[0]);
  if (!listing) return c.json({ error: 'Not found' }, 404);

  const pricing = await calculatePricing(id);
  if (!pricing) return c.json({ error: 'Could not calculate pricing' }, 422);
  return c.json(pricing);
});
