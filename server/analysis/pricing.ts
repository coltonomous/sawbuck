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

  const activePrices = comps.map(c => c.soldPrice);

  // All comps are active listings (Browse API) — apply 15% discount (asking > sold)
  const medianPrice = median(activePrices) * ACTIVE_DISCOUNT;
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
    soldCount: 0,
    activeCount: activePrices.length,
  };
}
