import { db } from '../db/index.js';
import { comparables, listings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { searchEbayComps, type CompSearchParams } from '../scrapers/ebay-comps.js';

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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function conditionMultiplier(conditionScore: number | null): number {
  const score = conditionScore ?? 5;
  // Score of 8 = 1.0 (baseline). Each point below = -0.1, each point above = +0.05
  if (score >= 8) return Math.min(1.2, 1.0 + (score - 8) * 0.05);
  return Math.max(0.3, 1.0 - (8 - score) * 0.1);
}

/**
 * Calculate a blended median price from sold and active comps.
 * - Sold-only (>= 3 sold): use sold median
 * - Both available: 70% sold median + 30% active median
 * - Active-only: active median discounted 15% (asking > actual)
 */
function blendedMedian(soldPrices: number[], activePrices: number[]): number {
  const soldMedian = median(soldPrices);
  const activeMedian = median(activePrices);

  if (soldPrices.length >= 3) {
    return soldMedian;
  }

  if (soldPrices.length > 0 && activePrices.length > 0) {
    return soldMedian * 0.7 + activeMedian * 0.3;
  }

  if (activePrices.length > 0) {
    return activeMedian * 0.85; // 15% discount for asking vs sold
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
    console.log(`[pricing] No comparables found for listing ${listingId}`);
    return null;
  }

  const soldPrices = comps.filter(c => c.source === 'ebay_sold' || c.source === 'ebay').map(c => c.soldPrice);
  const activePrices = comps.filter(c => c.source === 'ebay_active').map(c => c.soldPrice);

  const medianPrice = blendedMedian(soldPrices, activePrices);
  const cm = conditionMultiplier(listing.conditionScore);
  const estimatedValue = Math.round(medianPrice * cm * 100) / 100;

  // Refinished value: assume condition goes to 8+ after refinishing
  const refinishedMultiplier = conditionMultiplier(8.5);
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
