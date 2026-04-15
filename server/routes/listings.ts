import { Hono } from 'hono';
import { db } from '../db/index.js';
import { listings, listingImages, conceptRenders, refinishingPlans, materials, userDismissals, listingClicks, users } from '../db/schema.js';
import { eq, ne, desc, asc, and, or, gte, lte, count, sql, isNull, type Column } from 'drizzle-orm';
import { analyzeListing } from '../analysis/vision.js';
import { downloadListingImages } from '../images/downloader.js';
import { processListingImages } from '../images/processor.js';
import { calculatePricing } from '../analysis/pricing.js';
import { getPrimaryImagePath, getPrimaryImagePaths } from '../lib/images.js';
import { updateListingSchema, bulkUpdateListingsSchema, importListingSchema, createSawbuckListingSchema, editSawbuckListingSchema } from '../lib/validation.js';
import { parsePagination, buildOrderBy } from '../lib/pagination.js';
import { fingerprint } from '../lib/fingerprint.js';
import { backgroundJobs } from '../db/schema.js';
import logger from '../lib/logger.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { ORIGINALS_DIR, IMAGES_DIR } from '../lib/paths.js';
import { validateUpload, UploadError } from '../lib/upload.js';
import { inArray } from 'drizzle-orm';
import type { Platform } from '../../shared/constants.js';
import { parseId, escapeLike, getVisibleListing, getEditableListing, getOwnedListing } from './helpers.js';

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
          const styleConditions = styles.map((s) => sql`${listings.furnitureStyle} LIKE ${'%' + escapeLike(s) + '%'} ESCAPE '\\'`);
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
    // Exclude removed/dismissed listings and user-dismissed listings from the default feed
    conditions.push(sql`${listings.status} NOT IN ('removed', 'dismissed')`);
    conditions.push(sql`${listings.id} NOT IN (SELECT listing_id FROM user_dismissals WHERE user_id = ${user.id})`);
  }
  if (search || pagination.search) {
    const term = search || pagination.search!;
    conditions.push(sql`${listings.title} LIKE ${'%' + escapeLike(term) + '%'} ESCAPE '\\'`);
  }

  const whereClause = and(...conditions);

  const sortColumns: Record<string, Column> = {
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
    finishType: string;
    label: string;
    summary: string;
    localPath: string | null;
  }>>();
  if (agentListingIds.length > 0) {
    try {
      const renders = await db.select({
        listingId: conceptRenders.listingId,
        finishType: conceptRenders.finishType,
        label: conceptRenders.label,
        summary: conceptRenders.summary,
        localPath: conceptRenders.localPath,
      })
        .from(conceptRenders)
        .where(sql`${conceptRenders.listingId} IN (${sql.join(agentListingIds.map(id => sql`${id}`), sql`, `)})`)
        ;
      for (const r of renders) {
        if (!conceptMap.has(r.listingId)) conceptMap.set(r.listingId, []);
        conceptMap.get(r.listingId)!.push({
          finishType: r.finishType,
          label: r.label,
          summary: r.summary,
          localPath: r.localPath,
        });
      }
    } catch (err) {
      logger.warn({ error: String(err) }, 'Failed to load concept renders — the concept_renders table may need migration (run db:push or apply migration 0002)');
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

// Per-user import rate limit: 5 imports per 10-minute sliding window
const importHits = new Map<string, { count: number; resetAt: number }>();
const IMPORT_LIMIT = 5;
const IMPORT_WINDOW_MS = 10 * 60 * 1000;

// POST /import — import a listing by pasting its URL
listingsRouter.post('/import', async (c) => {
  const user = c.get('user');

  // Enforce per-user import rate limit
  const now = Date.now();
  const key = user.id;
  const entry = importHits.get(key);
  if (entry && now < entry.resetAt) {
    if (entry.count >= IMPORT_LIMIT) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfterSec));
      return c.json({ error: `Import limit reached (${IMPORT_LIMIT} per ${IMPORT_WINDOW_MS / 60000} minutes). Try again in ${Math.ceil(retryAfterSec / 60)} minutes.` }, 429);
    }
    entry.count++;
  } else {
    importHits.set(key, { count: 1, resetAt: now + IMPORT_WINDOW_MS });
  }

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

  // Check if this listing already exists in the database (any user or agent-discovered)
  const existing = await db.select()
    .from(listings)
    .where(and(eq(listings.platform, match.platform), eq(listings.externalId, externalId)))
    .then(r => r[0]);
  if (existing) {
    // Ensure the listing is visible for this user: remove any per-user dismissal
    await db.delete(userDismissals).where(
      and(eq(userDismissals.userId, user.id), eq(userDismissals.listingId, existing.id))
    );

    // If the agent globally dismissed it, restore it so it appears in feeds
    if (existing.status === 'dismissed' || existing.status === 'removed') {
      await db.update(listings)
        .set({ status: existing.furnitureType ? 'analyzed' : 'new' })
        .where(eq(listings.id, existing.id));
    }

    // If another user owns it, promote to shared so both users can see it
    if (existing.userId && existing.userId !== user.id) {
      await db.update(listings)
        .set({ userId: null })
        .where(eq(listings.id, existing.id));
    }

    return c.json({ listing: existing, alreadyExists: true });
  }

  // Insert stub listing
  const [inserted] = await db.insert(listings).values({
    externalId,
    platform: match.platform,
    url,
    title: '(imported — loading details…)',
    matchedSearchTerms: JSON.stringify(['manual-import']),
    fingerprint: fingerprint({ platform: match.platform, title: externalId }),
    userId: user.id,
  }).returning();

  // Re-fetch the listing with updated data + images
  const listing = await db.select().from(listings).where(eq(listings.id, inserted.id)).then(r => r[0]);
  const images = await db.select().from(listingImages).where(eq(listingImages.listingId, inserted.id));

  // Auto-analyze + generate concepts/plans/materials/renders in background (fire-and-forget)
  const listingId = inserted.id;
  (async () => {
    try {
      await downloadListingImages(listingId);
      await processListingImages(listingId);
      await analyzeListing(listingId);
      await calculatePricing(listingId).catch(() => {});
      logger.info({ listingId }, 'Auto-analysis complete for imported listing');

      // Generate concepts, plans, materials, and renders — same path as the agent pipeline
      const analyzed = await db.select().from(listings).where(eq(listings.id, listingId)).then(r => r[0]);
      if (analyzed?.furnitureType) {
        const { generatePlanOptions } = await import('../agents/nodes/plan-options.js');
        const mockState = {
          runId: `import-${listingId}`,
          startedAt: new Date().toISOString(),
          qualifiedListings: [{
            externalId: analyzed.externalId,
            platform: analyzed.platform,
            url: analyzed.url,
            title: analyzed.title,
            askingPrice: analyzed.askingPrice,
            location: analyzed.location ?? '',
            imageUrls: [],
            listingId,
            triageResult: { isWoodFurniture: true, hasFlipPotential: true, furnitureType: analyzed.furnitureType ?? '', reasoning: '', confidenceScore: 1 },
            evaluation: {
              furnitureType: analyzed.furnitureType ?? 'unknown',
              furnitureStyle: analyzed.furnitureStyle ?? 'unknown',
              conditionScore: analyzed.conditionScore ?? 5,
              woodSpecies: analyzed.woodSpecies ?? null,
              estimatedValue: analyzed.estimatedValue ?? 0,
              dealScore: analyzed.dealScore ?? 0,
              flipRecommendation: 'buy' as const,
              refinishingPotential: 'medium' as const,
              profitVerdict: '',
            },
          }],
          scrapedCandidates: [], triagedCandidates: [], passedTriage: [],
          evaluatedCandidates: [], listingsWithOptions: [], conceptRenders: [],
          removedIds: [], reconciledCount: 0, triageCount: {}, evalCount: {},
          qualifiedCount: 0, conceptsRendered: 0, scrapeAttempts: {},
          seenExternalIds: [], scrapeTask: null, errors: [], summary: null,
        };
        await generatePlanOptions(mockState as Parameters<typeof generatePlanOptions>[0]);
        logger.info({ listingId }, 'Concept/plan/render generation complete for imported listing');
      }
    } catch (err) {
      logger.warn({ listingId, error: String(err) }, 'Auto-analysis/generation failed for imported listing (non-fatal)');
    }
  })();

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

  // Auto-analyze + generate concepts/plans/materials/renders in background (fire-and-forget)
  const listingId = inserted.id;
  (async () => {
    try {
      // Photos are already on disk — just process (resize) them
      await processListingImages(listingId);
      await analyzeListing(listingId);
      await calculatePricing(listingId).catch(() => {});
      logger.info({ listingId }, 'Auto-analysis complete for sawbuck listing');

      const analyzed = await db.select().from(listings).where(eq(listings.id, listingId)).then(r => r[0]);
      if (analyzed?.furnitureType) {
        const { generatePlanOptions } = await import('../agents/nodes/plan-options.js');
        const mockState = {
          runId: `sawbuck-${listingId}`,
          startedAt: new Date().toISOString(),
          qualifiedListings: [{
            externalId: analyzed.externalId,
            platform: analyzed.platform,
            url: analyzed.url,
            title: analyzed.title,
            askingPrice: analyzed.askingPrice,
            location: analyzed.location ?? '',
            imageUrls: [],
            listingId,
            triageResult: { isWoodFurniture: true, hasFlipPotential: true, furnitureType: analyzed.furnitureType ?? '', reasoning: '', confidenceScore: 1 },
            evaluation: {
              furnitureType: analyzed.furnitureType ?? 'unknown',
              furnitureStyle: analyzed.furnitureStyle ?? 'unknown',
              conditionScore: analyzed.conditionScore ?? 5,
              woodSpecies: analyzed.woodSpecies ?? null,
              estimatedValue: analyzed.estimatedValue ?? 0,
              dealScore: analyzed.dealScore ?? 0,
              flipRecommendation: 'buy' as const,
              refinishingPotential: 'medium' as const,
              profitVerdict: '',
            },
          }],
          scrapedCandidates: [], triagedCandidates: [], passedTriage: [],
          evaluatedCandidates: [], listingsWithOptions: [], conceptRenders: [],
          removedIds: [], reconciledCount: 0, triageCount: {}, evalCount: {},
          qualifiedCount: 0, conceptsRendered: 0, scrapeAttempts: {},
          seenExternalIds: [], scrapeTask: null, errors: [], summary: null,
        };
        await generatePlanOptions(mockState as Parameters<typeof generatePlanOptions>[0]);
        logger.info({ listingId }, 'Concept/plan/render generation complete for sawbuck listing');
      }
    } catch (err) {
      logger.warn({ listingId, error: String(err) }, 'Auto-analysis/generation failed for sawbuck listing (non-fatal)');
    }
  })();

  return c.json({ listing: { ...inserted, images } }, 201);
});

// PATCH /create/:id — edit a user-posted sawbuck listing
listingsRouter.patch('/create/:id', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
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
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  let listing = await getVisibleListing(id, user.id);
  if (!listing) return c.json({ error: 'Not found' }, 404);

  // Load images and concept renders
  const images = await db.select().from(listingImages).where(eq(listingImages.listingId, id));
  let concepts: { finishType: string; label: string; summary: string; localPath: string | null }[] = [];
  try {
    concepts = await db.select({
      finishType: conceptRenders.finishType,
      label: conceptRenders.label,
      summary: conceptRenders.summary,
      localPath: conceptRenders.localPath,
    }).from(conceptRenders).where(eq(conceptRenders.listingId, id));
  } catch (err) {
    logger.warn({ listingId: id, error: String(err) }, 'Failed to load concept renders for listing detail — run db:push or apply migration 0002');
  }

  // Auto-fetch details if missing description, images, or description looks like a page dump
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

  // Load pre-generated plans (listing-level, no project association)
  const listingPlans = await db.select()
    .from(refinishingPlans)
    .where(and(eq(refinishingPlans.listingId, id), isNull(refinishingPlans.projectId)));
  const parsedPlans = listingPlans.map((p) => {
    let steps;
    try {
      steps = typeof p.steps === 'string' ? JSON.parse(p.steps) : p.steps;
    } catch {
      steps = [];
    }
    return { ...p, steps };
  });

  // Load materials for those plans
  const planIds = listingPlans.map((p) => p.id);
  const listingMaterials = planIds.length > 0
    ? await db.select().from(materials).where(inArray(materials.refinishingPlanId, planIds))
    : [];

  return c.json({
    ...listing,
    images,
    conceptImages: concepts.length > 0 ? concepts : null,
    plans: parsedPlans.length > 0 ? parsedPlans : null,
    materials: listingMaterials.length > 0 ? listingMaterials : null,
  });
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

  // Allow updating own listings + agent-discovered listings (userId IS NULL)
  const result = await db.transaction(async (tx) => {
    return tx.update(listings)
      .set(updates)
      .where(and(
        inArray(listings.id, ids),
        or(eq(listings.userId, user.id), isNull(listings.userId)),
      ));
  });

  return c.json({ updated: result.rowCount ?? 0 });
});

// PATCH /:id — update listing
listingsRouter.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const raw = await c.req.json();
  const parsed = updateListingSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const existing = await getEditableListing(id, user.id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.update(listings).set(parsed.data).where(eq(listings.id, id));
  const updated = await db.select().from(listings).where(eq(listings.id, id)).then(r => r[0]);

  return c.json(updated);
});

// POST /:id/click — track when user clicks to view the original listing
listingsRouter.post('/:id/click', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  await db.insert(listingClicks).values({ userId: user.id, listingId: id });
  return c.json({ ok: true });
});

// POST /:id/dismiss — dismiss a listing for the current user (per-user, not global)
listingsRouter.post('/:id/dismiss', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  await db.insert(userDismissals).values({
    userId: user.id,
    listingId: id,
  }).onConflictDoNothing();

  return c.json({ ok: true });
});

// DELETE /:id/dismiss — undismiss a listing for the current user
listingsRouter.delete('/:id/dismiss', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  await db.delete(userDismissals).where(
    and(eq(userDismissals.userId, user.id), eq(userDismissals.listingId, id))
  );

  return c.json({ ok: true });
});

// DELETE /:id — delete a listing (owner only)
listingsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const existing = await getOwnedListing(id, user.id);
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
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const listing = await getVisibleListing(id, user.id);
  if (!listing) return c.json({ error: 'Not found' }, 404);

  // Track the analysis job in backgroundJobs so clients can poll status
  const jobId = crypto.randomUUID();
  await db.insert(backgroundJobs).values({
    id: jobId,
    type: 'analyze',
    status: 'running',
    userId: user.id,
  });

  (async () => {
    try {
      await downloadListingImages(id);
      await processListingImages(id);
      const analysis = await analyzeListing(id);
      if (analysis) await calculatePricing(id);
      await db.update(backgroundJobs).set({ status: 'completed', completedAt: new Date() }).where(eq(backgroundJobs.id, jobId));
    } catch (err: any) {
      const errorMsg = `Analysis failed: ${err?.message || 'Unknown error'}`;
      logger.error({ err, listingId: id }, 'Error analyzing listing');
      await db.update(listings).set({ analysisError: errorMsg }).where(eq(listings.id, id));
      await db.update(backgroundJobs).set({ status: 'failed', error: errorMsg, completedAt: new Date() }).where(eq(backgroundJobs.id, jobId));
    }
  })();

  return c.json({ status: 'analyzing', jobId }, 202);
});

// GET /jobs/:jobId — poll analysis job status
listingsRouter.get('/jobs/:jobId', async (c) => {
  const user = c.get('user');
  const jobId = c.req.param('jobId');
  const job = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.userId, user.id))).then(r => r[0]);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(job);
});

// POST /:id/render — generate concept render on demand for a listing
listingsRouter.post('/:id/render', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const listing = await getVisibleListing(id, user.id);
  if (!listing) return c.json({ error: 'Not found' }, 404);

  if (!listing.furnitureType) {
    return c.json({ error: 'Listing must be analyzed before generating concepts' }, 422);
  }

  if (!process.env.FAL_KEY) {
    return c.json({ error: 'Concept rendering is not configured (FAL_KEY not set)' }, 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const finishType = (body.finishType as string) || 'stain';
  const label = (body.label as string) || finishType;
  const summary = (body.summary as string) || '';

  // Check if a render already exists for this listing + finishType
  const existing = await db.select().from(conceptRenders)
    .where(and(eq(conceptRenders.listingId, id), eq(conceptRenders.finishType, finishType)))
    .then(r => r[0]);

  if (existing?.localPath) {
    return c.json({ render: existing });
  }

  // Generate concept render
  try {
    const { fal } = await import('@fal-ai/client');
    const { agentConfig } = await import('../agents/config.js');
    const sharp = (await import('sharp')).default;
    const fs = (await import('fs/promises'));
    const path = (await import('path'));

    const CONCEPTS_DIR = 'data/images/concepts';
    await fs.mkdir(CONCEPTS_DIR, { recursive: true });

    const type = listing.furnitureType;

    // Try to load existing plan to build a specific prompt
    const existingPlan = await db.select().from(refinishingPlans)
      .where(eq(refinishingPlans.listingId, id))
      .then(r => r[0]).catch(() => null);

    const { buildEditPrompt, buildRenderPrompt } = await import('../lib/render-prompt.js');
    const promptOpts = { furnitureType: type!, finishType, label, summary };

    const { getListingImageUrlForFal } = await import('../lib/images.js');
    let referenceImageUrl: string | null = null;
    try {
      referenceImageUrl = await getListingImageUrlForFal(id);
    } catch {}

    let falModel: string;
    let prompt: string;
    const falInput: Record<string, unknown> = { num_images: 1 };

    if (referenceImageUrl) {
      // Use Kontext — an editing model that changes the surface finish
      // while preserving furniture shape. Standard img2img can't do this.
      falModel = agentConfig.conceptEditModel;
      prompt = buildEditPrompt(promptOpts);
      falInput.prompt = prompt;
      falInput.image_url = referenceImageUrl;
    } else {
      falModel = agentConfig.falModel;
      prompt = buildRenderPrompt({ ...promptOpts, afterDescription: existingPlan?.afterDescription ?? undefined, styleRecommendation: existingPlan?.styleRecommendation ?? undefined });
      falInput.prompt = prompt;
      falInput.image_size = { width: agentConfig.conceptRenderSize, height: agentConfig.conceptRenderSize };
    }

    const result = await fal.subscribe(falModel, {
      input: falInput,
    }) as { data: { images: Array<{ url: string }> } };

    const imageUrl = result.data?.images?.[0]?.url;
    if (!imageUrl) {
      return c.json({ error: 'Image generation returned no results' }, 502);
    }

    const filename = `${id}_${finishType}.webp`;
    const filePath = path.join(CONCEPTS_DIR, filename);
    const relativePath = path.join('concepts', filename);
    const response = await fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    await sharp(buffer).webp({ quality: 85 }).toFile(filePath);

    // Upsert concept render row
    if (existing) {
      await db.update(conceptRenders)
        .set({ prompt, renderedImageUrl: imageUrl, localPath: relativePath })
        .where(eq(conceptRenders.id, existing.id));
    } else {
      await db.insert(conceptRenders).values({
        listingId: id,
        finishType,
        label,
        summary: summary || label,
        prompt,
        renderedImageUrl: imageUrl,
        localPath: relativePath,
      });
    }

    const render = await db.select().from(conceptRenders)
      .where(and(eq(conceptRenders.listingId, id), eq(conceptRenders.finishType, finishType)))
      .then(r => r[0]);

    return c.json({ render });
  } catch (err) {
    logger.error({ listingId: id, finishType, error: String(err) }, 'On-demand concept render failed');
    return c.json({ error: 'Failed to generate concept render' }, 500);
  }
});

// POST /:id/generate-concepts — generate refinishing concept options for a listing
listingsRouter.post('/:id/generate-concepts', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const listing = await getVisibleListing(id, user.id);
  if (!listing) return c.json({ error: 'Not found' }, 404);
  if (!listing.furnitureType) {
    return c.json({ error: 'Listing must be analyzed first' }, 422);
  }

  // Check if concepts already exist
  const existing = await db.select().from(conceptRenders).where(eq(conceptRenders.listingId, id));
  if (existing.length > 0) {
    return c.json({ concepts: existing });
  }

  try {
    const { generatePlanOptions } = await import('../agents/nodes/plan-options.js');

    const mockState = {
      runId: 'on-demand',
      startedAt: new Date().toISOString(),
      qualifiedListings: [{
        externalId: listing.externalId,
        platform: listing.platform,
        url: listing.url,
        title: listing.title,
        askingPrice: listing.askingPrice,
        location: listing.location ?? '',
        imageUrls: [],
        listingId: id,
        triageResult: { isWoodFurniture: true, hasFlipPotential: true, furnitureType: listing.furnitureType ?? '', reasoning: '', confidenceScore: 1 },
        evaluation: {
          furnitureType: listing.furnitureType ?? 'unknown',
          furnitureStyle: listing.furnitureStyle ?? 'unknown',
          conditionScore: listing.conditionScore ?? 5,
          woodSpecies: listing.woodSpecies ?? null,
          estimatedValue: listing.estimatedValue ?? 0,
          dealScore: listing.dealScore ?? 0,
          flipRecommendation: 'buy' as const,
          refinishingPotential: 'medium' as const,
          profitVerdict: '',
        },
      }],
      scrapedCandidates: [], triagedCandidates: [], passedTriage: [],
      evaluatedCandidates: [], listingsWithOptions: [], conceptRenders: [],
      removedIds: [], reconciledCount: 0, triageCount: {}, evalCount: {},
      qualifiedCount: 0, conceptsRendered: 0, scrapeAttempts: {},
      seenExternalIds: [], scrapeTask: null, errors: [], summary: null,
    };

    await generatePlanOptions(mockState as Parameters<typeof generatePlanOptions>[0]);

    const concepts = await db.select().from(conceptRenders).where(eq(conceptRenders.listingId, id));
    return c.json({ concepts });
  } catch (err) {
    logger.error({ listingId: id, error: String(err) }, 'On-demand concept generation failed');
    return c.json({ error: 'Failed to generate concepts' }, 500);
  }
});


// GET /:id/price — get or calculate pricing
listingsRouter.get('/:id/price', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const listing = await getOwnedListing(id, user.id);
  if (!listing) return c.json({ error: 'Not found' }, 404);

  const pricing = await calculatePricing(id);
  if (!pricing) return c.json({ error: 'Could not calculate pricing' }, 422);
  return c.json(pricing);
});
