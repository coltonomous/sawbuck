import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { listings, listingImages, searchConfigs, scrapeRuns, platformSettings } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { CraigslistScraper } from './craigslist.js';
import { filterRelevant } from './relevance-filter.js';
import { OfferUpScraper } from './offerup.js';
import { MercariScraper } from './mercari.js';
import { EbayScraper } from './ebay.js';
import { closeBrowser } from './browser-pool.js';
import type { BaseScraper, ScrapedListing, ScraperConfig } from './base-scraper.js';

const scraperMap: Record<string, () => BaseScraper> = {
  craigslist: () => new CraigslistScraper(),
  offerup: () => new OfferUpScraper(),
  mercari: () => new MercariScraper(),
  ebay: () => new EbayScraper(),
};

function fingerprint(listing: ScrapedListing): string {
  const normalized = `${listing.platform}:${listing.title.toLowerCase().trim()}:${listing.askingPrice ?? ''}:${listing.location?.toLowerCase().trim() ?? ''}`;
  return createHash('md5').update(normalized).digest('hex');
}

export interface ScrapeResult {
  platform: string;
  found: number;
  relevant: number;
  filtered: number;
  new: number;
  duplicate: number;
  newListingIds: number[];
  error?: string;
}

export async function runScraper(
  platform: string,
  config: ScraperConfig,
  searchConfigId?: number,
): Promise<ScrapeResult> {
  const scraperFactory = scraperMap[platform];
  if (!scraperFactory) throw new Error(`Unknown platform: ${platform}`);

  const scraper = scraperFactory();
  const result: ScrapeResult = { platform, found: 0, relevant: 0, filtered: 0, new: 0, duplicate: 0, newListingIds: [] };
  const searchTerm = config.searchTerm;

  // Record run start
  const [run] = await db.insert(scrapeRuns).values({
    platform,
    searchConfigId: searchConfigId ?? null,
  }).returning();

  try {
    const scraped = await scraper.scrape(config);
    result.found = scraped.length;

    // Filter to relevant results only
    // CL: strict synonym matching (keyword spam problem). OfferUp/Mercari: loose "is furniture?" check.
    const { relevant: filtered, dropped } = filterRelevant(scraped, searchTerm, platform);
    result.relevant = filtered.length;
    result.filtered = dropped;
    if (dropped > 0) {
      console.log(`[manager] ${platform}: filtered out ${dropped} irrelevant results (${filtered.length} relevant of ${scraped.length})`);
    }

    for (const item of filtered) {
      const fp = fingerprint(item);

      // Try insert — unique constraint on (platform, external_id) prevents duplicates
      try {
        const [inserted] = await db.insert(listings).values({
          externalId: item.externalId,
          platform: item.platform,
          url: item.url,
          title: item.title,
          description: item.description,
          askingPrice: item.askingPrice,
          location: item.location,
          latitude: item.latitude,
          longitude: item.longitude,
          sellerName: item.sellerName,
          postedAt: item.postedAt,
          fingerprint: fp,
          matchedSearchTerms: JSON.stringify([searchTerm]),
        }).onConflictDoNothing()
          .returning();

        if (inserted) {
          result.new++;
          result.newListingIds.push(inserted.id);

          // Insert image records for download later
          for (let i = 0; i < item.imageUrls.length; i++) {
            await db.insert(listingImages).values({
              listingId: inserted.id,
              sourceUrl: item.imageUrls[i],
              isPrimary: i === 0,
            });
          }
        } else {
          result.duplicate++;
          // Append search term to existing listing if not already there
          const existing = await db.select({ id: listings.id, matchedSearchTerms: listings.matchedSearchTerms })
            .from(listings)
            .where(and(eq(listings.platform, item.platform), eq(listings.externalId, item.externalId)))
            .get();
          if (existing) {
            const terms: string[] = existing.matchedSearchTerms ? JSON.parse(existing.matchedSearchTerms) : [];
            if (!terms.includes(searchTerm)) {
              terms.push(searchTerm);
              await db.update(listings).set({ matchedSearchTerms: JSON.stringify(terms) }).where(eq(listings.id, existing.id));
            }
          }
        }
      } catch (err: any) {
        // UNIQUE constraint violation = duplicate
        if (err?.message?.includes('UNIQUE')) {
          result.duplicate++;
        } else {
          console.error(`[manager] Insert error for ${item.url}:`, err);
        }
      }
    }

    // Update run record
    await db.update(scrapeRuns).set({
      status: 'completed',
      completedAt: new Date().toISOString(),
      listingsFound: result.found,
      listingsNew: result.new,
      listingsDuplicate: result.duplicate,
    }).where(eq(scrapeRuns.id, run.id));

    // Update search config last_run_at
    if (searchConfigId) {
      await db.update(searchConfigs).set({
        lastRunAt: new Date().toISOString(),
      }).where(eq(searchConfigs.id, searchConfigId));
    }

    console.log(`[manager] ${platform}: ${result.found} found, ${result.filtered} filtered, ${result.relevant} relevant, ${result.new} new, ${result.duplicate} duplicate`);
  } catch (err: any) {
    result.error = err.message;
    await db.update(scrapeRuns).set({
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: err.message,
    }).where(eq(scrapeRuns.id, run.id));
    console.error(`[manager] ${platform} scraper failed:`, err.message);
  }

  return result;
}

export interface ScrapeProgress {
  type: 'start' | 'config_start' | 'config_done' | 'done';
  total?: number;
  current?: number;
  platform?: string;
  searchTerm?: string;
  result?: ScrapeResult;
  results?: ScrapeResult[];
}

export async function runAllActiveScrapers(
  onProgress?: (progress: ScrapeProgress) => void,
): Promise<ScrapeResult[]> {
  // Get enabled platforms from platform_settings
  const allPlatformSettings = await db.select().from(platformSettings);
  const enabledPlatforms = allPlatformSettings.filter(p => p.enabled).map(p => p.platform);

  // If no platform settings exist yet, default to all
  const activePlatforms = enabledPlatforms.length > 0
    ? enabledPlatforms
    : ['craigslist', 'offerup', 'mercari', 'ebay'];

  // Auto-insert missing platform rows so new platforms appear in Settings UI
  const knownPlatforms = Object.keys(scraperMap);
  const existingPlatforms = new Set<string>(allPlatformSettings.map(p => p.platform));
  for (const p of knownPlatforms) {
    if (!existingPlatforms.has(p)) {
      await db.insert(platformSettings).values({ platform: p as any, enabled: true }).onConflictDoNothing();
    }
  }

  const allConfigs = await db.select().from(searchConfigs).where(eq(searchConfigs.isActive, true));

  if (allConfigs.length === 0) {
    console.log('[manager] No active search configs found');
    return [];
  }

  // Expand configs: platform-agnostic ('all') configs fan out across enabled platforms,
  // legacy per-platform configs only run if that platform is enabled
  const jobs: { platform: string; config: typeof allConfigs[0] }[] = [];
  for (const config of allConfigs) {
    if ((config.platform as string) === 'all') {
      for (const p of activePlatforms) {
        jobs.push({ platform: p, config });
      }
    } else if (activePlatforms.includes(config.platform as any)) {
      jobs.push({ platform: config.platform, config });
    }
  }

  if (jobs.length === 0) {
    console.log('[manager] All platforms disabled or no matching configs');
    return [];
  }

  onProgress?.({ type: 'start', total: jobs.length });

  const results: ScrapeResult[] = [];

  for (let i = 0; i < jobs.length; i++) {
    const { platform, config } = jobs[i];
    const scraperConfig: ScraperConfig = {
      searchTerm: config.searchTerm,
      location: config.location ?? undefined,
      minPrice: config.minPrice ?? undefined,
      maxPrice: config.maxPrice ?? undefined,
      category: config.category ?? undefined,
    };

    onProgress?.({
      type: 'config_start',
      current: i + 1,
      total: jobs.length,
      platform,
      searchTerm: config.searchTerm,
    });

    const result = await runScraper(platform, scraperConfig, config.id);
    results.push(result);

    onProgress?.({
      type: 'config_done',
      current: i + 1,
      total: jobs.length,
      platform,
      searchTerm: config.searchTerm,
      result,
    });
  }

  // Close browser after all scraping is done
  await closeBrowser();

  // Update lastRunAt on all configs that were used
  const configIds = [...new Set(allConfigs.map(c => c.id))];
  for (const id of configIds) {
    await db.update(searchConfigs).set({
      lastRunAt: new Date().toISOString(),
    }).where(eq(searchConfigs.id, id));
  }

  onProgress?.({ type: 'done', results });

  return results;
}
