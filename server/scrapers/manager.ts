import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { listings, listingImages, searchConfigs, scrapeRuns, platformSettings } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import type { Platform } from '../../shared/constants.js';
import { CraigslistScraper } from './craigslist.js';
import { filterRelevant } from './relevance-filter.js';
import { OfferUpScraper } from './offerup.js';
import { MercariScraper } from './mercari.js';
import { EbayScraper } from './ebay.js';
import { FacebookScraper } from './facebook.js';
import { closeBrowser } from './browser-pool.js';
import logger from '../lib/logger.js';
import type { BaseScraper, ScrapedListing, ScraperConfig } from './base-scraper.js';

const scraperMap: Record<string, () => BaseScraper> = {
  craigslist: () => new CraigslistScraper(),
  offerup: () => new OfferUpScraper(),
  mercari: () => new MercariScraper(),
  ebay: () => new EbayScraper(),
  facebook: () => new FacebookScraper(),
};

export function fingerprint(listing: ScrapedListing): string {
  const normalized = `${listing.platform}:${listing.title.toLowerCase().trim()}:${listing.askingPrice ?? ''}:${listing.location?.toLowerCase().trim() ?? ''}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
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
  warning?: string;
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

    // Validate scraper output — warn if selectors may be broken
    if (scraped.length === 0) {
      logger.warn({ platform }, 'Returned 0 results — selectors may be broken');
    }
    for (const item of scraped) {
      if (!item.title || !item.externalId) {
        logger.warn({ platform }, 'Returned item with missing title/id — selectors likely broken');
        break;
      }
    }

    // Filter to relevant results only
    // CL: strict synonym matching (keyword spam problem). OfferUp/Mercari: loose "is furniture?" check.
    const { relevant: filtered, dropped } = filterRelevant(scraped, searchTerm, platform);
    result.relevant = filtered.length;
    result.filtered = dropped;
    if (dropped > 0) {
      logger.info({ platform, dropped, relevant: filtered.length, total: scraped.length }, 'Filtered irrelevant results');
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
          logger.error({ err, url: item.url }, 'Insert error');
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

    logger.info({ platform, found: result.found, filtered: result.filtered, relevant: result.relevant, new: result.new, duplicate: result.duplicate }, 'Scrape completed');
  } catch (err: any) {
    result.error = err.message;
    await db.update(scrapeRuns).set({
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: err.message,
    }).where(eq(scrapeRuns.id, run.id));
    logger.error({ platform, err: err.message }, 'Scraper failed');
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
    : ['craigslist', 'offerup', 'mercari', 'ebay', 'facebook'];

  // Auto-insert missing platform rows so new platforms appear in Settings UI
  const knownPlatforms = Object.keys(scraperMap);
  const existingPlatforms = new Set<string>(allPlatformSettings.map(p => p.platform));
  for (const p of knownPlatforms) {
    if (!existingPlatforms.has(p)) {
      await db.insert(platformSettings).values({ platform: p as Platform, enabled: true }).onConflictDoNothing();
    }
  }

  const allConfigs = await db.select().from(searchConfigs).where(eq(searchConfigs.isActive, true));

  if (allConfigs.length === 0) {
    logger.info('No active search configs found');
    return [];
  }

  // Expand configs: platform-agnostic ('all') configs fan out across enabled platforms,
  // legacy per-platform configs only run if that platform is enabled
  const activeSet = new Set<string>(activePlatforms);
  const jobs: { platform: string; config: typeof allConfigs[0] }[] = [];
  for (const config of allConfigs) {
    if ((config.platform as string) === 'all') {
      for (const p of activePlatforms) {
        jobs.push({ platform: p, config });
      }
    } else if (activeSet.has(config.platform)) {
      jobs.push({ platform: config.platform, config });
    }
  }

  if (jobs.length === 0) {
    logger.info('All platforms disabled or no matching configs');
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

  // Health check: flag platforms that returned 0 results across ALL their configs.
  // A single config returning 0 is normal (niche search term), but if every config
  // for a platform returns 0 found, the selectors are almost certainly broken.
  const perPlatform = new Map<string, { totalFound: number; configs: number; allFailed: boolean }>();
  for (const r of results) {
    const entry = perPlatform.get(r.platform) || { totalFound: 0, configs: 0, allFailed: true };
    entry.configs++;
    entry.totalFound += r.found;
    if (!r.error) entry.allFailed = false;
    perPlatform.set(r.platform, entry);
  }
  for (const [platform, stats] of perPlatform) {
    if (stats.allFailed) {
      const msg = `${platform}: all ${stats.configs} config(s) failed — scraper may be broken or platform is blocking`;
      logger.error({ platform, configs: stats.configs }, msg);
      // Tag each result for this platform so the frontend can surface the warning
      for (const r of results) {
        if (r.platform === platform) r.warning = msg;
      }
    } else if (stats.totalFound === 0 && stats.configs > 0) {
      const msg = `${platform}: 0 results across ${stats.configs} config(s) — selectors may be broken`;
      logger.warn({ platform, configs: stats.configs }, msg);
      for (const r of results) {
        if (r.platform === platform) r.warning = msg;
      }
    }
  }

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
