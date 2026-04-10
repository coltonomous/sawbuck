import { db } from '../db/index.js';
import { comparables, listings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { searchEbayComps, type CompSearchParams } from '../lib/ebay-comps.js';
import logger from '../lib/logger.js';

// Pricing algorithm tuning — these are domain constants, not runtime config
const SOLD_WEIGHT = 0.7;
const ACTIVE_WEIGHT = 0.3;
const ACTIVE_DISCOUNT = 0.85; // active listings ask more than sold prices
const MIN_SOLD_FOR_SOLD_ONLY = 3;
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

export function conditionMultiplier(conditionScore: number | null): number {
  const score = conditionScore ?? 5;
  if (score >= CONDITION_BASELINE) return Math.min(CONDITION_MAX_MULTIPLIER, 1.0 + (score - CONDITION_BASELINE) * CONDITION_ABOVE_FACTOR);
  return Math.max(CONDITION_MIN_MULTIPLIER, 1.0 - (CONDITION_BASELINE - score) * CONDITION_BELOW_FACTOR);
}

/**
 * Calculate a blended median price from sold and active comps.
 * - Sold-only (>= 3 sold): use sold median
 * - Both available: 70% sold median + 30% active median
 * - Active-only: active median discounted 15% (asking > actual)
 */
export function blendedMedian(soldPrices: number[], activePrices: number[]): number {
  const soldMedian = median(soldPrices);
  const activeMedian = median(activePrices);

  if (soldPrices.length >= MIN_SOLD_FOR_SOLD_ONLY) {
    return soldMedian;
  }

  if (soldPrices.length > 0 && activePrices.length > 0) {
    return soldMedian * SOLD_WEIGHT + activeMedian * ACTIVE_WEIGHT;
  }

  if (activePrices.length > 0) {
    return activeMedian * ACTIVE_DISCOUNT;
  }

  return soldMedian; // May be 0 if both empty
}

export async function calculatePricing(listingId: number): Promise<PricingResult | null> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
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

  const soldPrices = comps.filter(c => c.source === 'ebay_sold' || c.source === 'ebay').map(c => c.soldPrice);
  const activePrices = comps.filter(c => c.source === 'ebay_active').map(c => c.soldPrice);

  const medianPrice = blendedMedian(soldPrices, activePrices);
  const cm = conditionMultiplier(listing.conditionScore);
  const estimatedValue = Math.round(medianPrice * cm * 100) / 100;

  // Refinished value: assume condition goes to baseline+ after refinishing
  const refinishedMultiplier = conditionMultiplier(REFINISHED_CONDITION_SCORE);
  const estimatedRefinishedValue = Math.round(medianPrice * refinishedMultiplier * 100) / 100;

  const askingPrice = listing.askingPrice || 0;
  const dealScore = askingPrice > 0
    ? Math.round((estimatedValue / askingPrice) * 100) / 100
    : 0;

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
    soldCount: soldPrices.length,
    activeCount: activePrices.length,
  };
}
