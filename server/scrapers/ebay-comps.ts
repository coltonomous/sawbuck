import { db } from '../db/index.js';
import { comparables } from '../db/schema.js';
import { searchEbayBrowse } from '../lib/ebay.js';
import logger from '../lib/logger.js';

export interface CompSearchParams {
  furnitureType?: string | null;
  furnitureStyle?: string | null;
  woodSpecies?: string | null;
  title?: string | null;
}

export interface EbayComp {
  title: string;
  soldPrice: number;
  soldDate?: string;
  url: string;
  condition?: string;
  source: 'ebay_active';
}

export interface EbayCompsResult {
  comps: EbayComp[];
}

export function buildQueryVariants(params: CompSearchParams): string[] {
  const variants: string[] = [];
  const { furnitureType, furnitureStyle, woodSpecies, title } = params;

  // Most specific first
  if (furnitureStyle && furnitureType) {
    variants.push(`${furnitureStyle} ${furnitureType}`);
  }
  if (woodSpecies && furnitureType) {
    variants.push(`${woodSpecies} ${furnitureType}`);
  }
  if (furnitureType) {
    variants.push(furnitureType);
  }
  // Title keywords as last resort
  if (title) {
    const keywords = title.split(/\s+/).slice(0, 4).join(' ');
    if (keywords && !variants.includes(keywords)) {
      variants.push(keywords);
    }
  }

  return variants.filter(Boolean);
}

export async function searchEbayComps(params: CompSearchParams, listingId?: number): Promise<EbayCompsResult> {
  const queries = buildQueryVariants(params);
  if (queries.length === 0) {
    return { comps: [] };
  }

  const results: EbayComp[] = [];

  // Try each query variant via Browse API, stop at first with >= 3 results
  for (const query of queries) {
    try {
      const activeItems = await searchEbayBrowse({ query, limit: 20 });

      if (activeItems.length >= 3 || query === queries[queries.length - 1]) {
        for (const item of activeItems) {
          const ebayComp: EbayComp = {
            title: item.title,
            soldPrice: item.price,
            url: item.itemWebUrl,
            condition: item.condition,
            source: 'ebay_active',
          };

          if (listingId) {
            await db.insert(comparables).values({
              listingId,
              source: 'ebay_active',
              sourceUrl: item.itemWebUrl,
              title: item.title,
              soldPrice: item.price,
              condition: item.condition || null,
              searchQuery: query,
            });
          }

          results.push(ebayComp);
        }

        if (activeItems.length >= 3) {
          logger.info({ query, count: activeItems.length }, 'Found eBay active comps via Browse API');
          break;
        }
      }
    } catch (err: any) {
      logger.error({ query, err: err.message }, 'eBay Browse API error');
    }
  }

  return { comps: results };
}
