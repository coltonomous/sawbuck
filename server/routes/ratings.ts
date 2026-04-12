import { Hono } from 'hono';
import { db } from '../db/index.js';
import { analysisRatings, planRatings, listings, refinishingPlans } from '../db/schema.js';
import { eq, and, avg, count } from 'drizzle-orm';
import { submitAnalysisRatingSchema, submitPlanRatingSchema } from '../lib/validation.js';

export const ratingsRouter = new Hono();

// ============================================================
// Analysis Ratings
// ============================================================

// PUT /analysis/:listingId — create or update an analysis rating
ratingsRouter.put('/analysis/:listingId', async (c) => {
  const user = c.get('user');
  const listingId = parseInt(c.req.param('listingId'));

  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).then(r => r[0]);
  if (!listing) return c.json({ error: 'Listing not found' }, 404);
  if (!listing.furnitureType) return c.json({ error: 'Listing has not been analyzed yet' }, 422);

  const raw = await c.req.json();
  const parsed = submitAnalysisRatingSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const existing = await db.select()
    .from(analysisRatings)
    .where(and(eq(analysisRatings.listingId, listingId), eq(analysisRatings.userId, user.id)))
    .then(r => r[0]);

  if (existing) {
    const [updated] = await db.update(analysisRatings)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(analysisRatings.id, existing.id))
      .returning();
    return c.json(updated);
  }

  const [created] = await db.insert(analysisRatings)
    .values({ ...parsed.data, listingId, userId: user.id })
    .returning();
  return c.json(created, 201);
});

// GET /analysis/:listingId — get the current user's rating for a listing analysis
ratingsRouter.get('/analysis/:listingId', async (c) => {
  const user = c.get('user');
  const listingId = parseInt(c.req.param('listingId'));

  const rating = await db.select()
    .from(analysisRatings)
    .where(and(eq(analysisRatings.listingId, listingId), eq(analysisRatings.userId, user.id)))
    .then(r => r[0] ?? null);

  return c.json(rating);
});

// ============================================================
// Plan Ratings
// ============================================================

// PUT /plan/:planId — create or update a plan rating
ratingsRouter.put('/plan/:planId', async (c) => {
  const user = c.get('user');
  const planId = parseInt(c.req.param('planId'));

  const plan = await db.select().from(refinishingPlans).where(eq(refinishingPlans.id, planId)).then(r => r[0]);
  if (!plan) return c.json({ error: 'Plan not found' }, 404);

  const raw = await c.req.json();
  const parsed = submitPlanRatingSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const existing = await db.select()
    .from(planRatings)
    .where(and(eq(planRatings.refinishingPlanId, planId), eq(planRatings.userId, user.id)))
    .then(r => r[0]);

  if (existing) {
    const [updated] = await db.update(planRatings)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(planRatings.id, existing.id))
      .returning();
    return c.json(updated);
  }

  const [created] = await db.insert(planRatings)
    .values({ ...parsed.data, refinishingPlanId: planId, userId: user.id })
    .returning();
  return c.json(created, 201);
});

// GET /plan/:planId — get the current user's rating for a plan
ratingsRouter.get('/plan/:planId', async (c) => {
  const user = c.get('user');
  const planId = parseInt(c.req.param('planId'));

  const rating = await db.select()
    .from(planRatings)
    .where(and(eq(planRatings.refinishingPlanId, planId), eq(planRatings.userId, user.id)))
    .then(r => r[0] ?? null);

  return c.json(rating);
});

// ============================================================
// Aggregate Analytics
// ============================================================

// GET /analytics — aggregate accuracy trends across all ratings
ratingsRouter.get('/analytics', async (c) => {
  const [analysisAgg] = await db.select({
    count: count(),
    avgOverall: avg(analysisRatings.overallRating),
    avgCondition: avg(analysisRatings.conditionAccuracy),
    avgWoodId: avg(analysisRatings.woodIdAccuracy),
    avgPrice: avg(analysisRatings.priceAccuracy),
    avgRecommendation: avg(analysisRatings.recommendationHelpful),
  }).from(analysisRatings);

  const [planAgg] = await db.select({
    count: count(),
    avgOverall: avg(planRatings.overallRating),
    avgStepClarity: avg(planRatings.stepClarity),
    avgTimeAccuracy: avg(planRatings.timeAccuracy),
    avgMaterialAccuracy: avg(planRatings.materialAccuracy),
    avgResultQuality: avg(planRatings.resultQuality),
  }).from(planRatings);

  const analysisDistribution = await db.select({
    rating: analysisRatings.overallRating,
    count: count(),
  }).from(analysisRatings).groupBy(analysisRatings.overallRating);

  const planDistribution = await db.select({
    rating: planRatings.overallRating,
    count: count(),
  }).from(planRatings).groupBy(planRatings.overallRating);

  return c.json({
    analysis: {
      totalRatings: analysisAgg.count,
      averages: {
        overall: round(analysisAgg.avgOverall),
        conditionAccuracy: round(analysisAgg.avgCondition),
        woodIdAccuracy: round(analysisAgg.avgWoodId),
        priceAccuracy: round(analysisAgg.avgPrice),
        recommendationHelpful: round(analysisAgg.avgRecommendation),
      },
      distribution: analysisDistribution,
    },
    plan: {
      totalRatings: planAgg.count,
      averages: {
        overall: round(planAgg.avgOverall),
        stepClarity: round(planAgg.avgStepClarity),
        timeAccuracy: round(planAgg.avgTimeAccuracy),
        materialAccuracy: round(planAgg.avgMaterialAccuracy),
        resultQuality: round(planAgg.avgResultQuality),
      },
      distribution: planDistribution,
    },
  });
});

function round(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  return Math.round(parseFloat(String(val)) * 100) / 100;
}
