import { db } from '../db/index.js';
import { comparables, listings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { searchEbayComps, type CompSearchParams } from '../lib/ebay-comps.js';
import logger from '../lib/logger.js';

// Pricing algorithm tuning
const ACTIVE_DISCOUNT = 0.85; // active listings ask more than actual sale prices
const CONDITION_BASELINE = 8;
const CONDITION_ABOVE_FACTOR = 0.05;
const CONDITION_BELOW_FACTOR = 0.1;
const CONDITION_MAX_MULTIPLIER = 1.2;
const CONDITION_MIN_MULTIPLIER = 0.3;
const REFINISHED_CONDITION_SCORE = 8.5;

export interface PricingResult {
  estimatedValue: number;
  estimatedRefinishedValue: number;
  dealScore: number;
  comparableCount: number;
  medianCompPrice: number;
  conditionMultiplier: number;
  soldCount: number;
  activeCount: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Remove outliers using IQR (interquartile range) method.
 * Values below Q1 - 1.5*IQR or above Q3 + 1.5*IQR are excluded.
 * Returns the filtered array. If fewer than 4 values, returns as-is
 * (not enough data for meaningful IQR).
 */
export function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return sorted.filter((v) => v >= lowerBound && v <= upperBound);
}

export function conditionMultiplier(conditionScore: number | null): number {
  const score = conditionScore ?? 5;
  if (score >= CONDITION_BASELINE) return Math.min(CONDITION_MAX_MULTIPLIER, 1.0 + (score - CONDITION_BASELINE) * CONDITION_ABOVE_FACTOR);
  return Math.max(CONDITION_MIN_MULTIPLIER, 1.0 - (CONDITION_BASELINE - score) * CONDITION_BELOW_FACTOR);
}

export async function calculatePricing(listingId: number): Promise<PricingResult | null> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).then(r => r[0]);
  if (!listing) return null;

  // Build structured search params
  const params: CompSearchParams = {
    furnitureType: listing.furnitureType,
    furnitureStyle: listing.furnitureStyle,
    woodSpecies: listing.woodSpecies,
    title: listing.title,
  };

  // Get existing comps or search for new ones
  let comps = await db.select().from(comparables).where(eq(comparables.listingId, listingId));
  if (comps.length === 0) {
    await searchEbayComps(params, listingId);
    comps = await db.select().from(comparables).where(eq(comparables.listingId, listingId));
  }

  if (comps.length === 0) {
    logger.info({ listingId }, 'No comparables found for listing');
    return null;
  }

  const rawPrices = comps.map(c => c.soldPrice);
  const activePrices = removeOutliers(rawPrices);

  if (activePrices.length === 0) {
    logger.info({ listingId, rawCount: rawPrices.length }, 'All comparables filtered as outliers');
    return null;
  }

  if (activePrices.length < rawPrices.length) {
    logger.info({ listingId, raw: rawPrices.length, filtered: activePrices.length }, 'Outlier comps removed from pricing');
  }

  // Active listings (Browse API) — apply 15% discount (asking > sold)
  const medianPrice = median(activePrices) * ACTIVE_DISCOUNT;
  const cm = conditionMultiplier(listing.conditionScore);
  const estimatedValue = Math.round(medianPrice * cm * 100) / 100;

  // Refinished value: assume condition goes to baseline+ after refinishing
  const refinishedMultiplier = conditionMultiplier(REFINISHED_CONDITION_SCORE);
  const estimatedRefinishedValue = Math.round(medianPrice * refinishedMultiplier * 100) / 100;

  const askingPrice = listing.askingPrice;
  // Free or unpriced listings with positive estimated value are the best possible deals
  const dealScore = askingPrice != null && askingPrice > 0
    ? Math.round((estimatedValue / askingPrice) * 100) / 100
    : estimatedValue > 0 ? 99 : 0;

  // Update the listing
  await db.update(listings).set({
    estimatedValue,
    estimatedRefinishedValue,
    dealScore,
  }).where(eq(listings.id, listingId));

  return {
    estimatedValue,
    estimatedRefinishedValue,
    dealScore,
    comparableCount: comps.length,
    medianCompPrice: medianPrice,
    conditionMultiplier: cm,
    soldCount: 0,
    activeCount: activePrices.length,
  };
}
