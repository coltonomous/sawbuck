import { runAllActiveScrapers } from '../server/scrapers/manager.js';
import { downloadImagesForNewListings } from '../server/images/downloader.js';
import { processListingImages } from '../server/images/processor.js';
import { cleanupOrphanedImages } from '../server/images/cleanup.js';
import { analyzeListing } from '../server/analysis/vision.js';
import { calculatePricing } from '../server/analysis/pricing.js';
import { closeBrowser } from '../server/scrapers/browser-pool.js';
import { db } from '../server/db/index.js';
import { listings } from '../server/db/schema.js';
import { eq, isNull } from 'drizzle-orm';

const ANALYSIS_BATCH_SIZE = 20;

async function main() {
  const startTime = Date.now();
  console.log(`[cron] Starting run at ${new Date().toISOString()}`);

  try {
    // Step 1: Run all active scrapers
    console.log('[cron] Step 1: Scraping...');
    const scrapeResults = await runAllActiveScrapers();
    const allNewIds = scrapeResults.flatMap((r) => r.newListingIds);
    console.log(`[cron] Scraped: ${scrapeResults.map((r) => `${r.platform}=${r.new} new`).join(', ')}`);

    // Surface selector warnings prominently
    const warnings = scrapeResults.filter((r) => r.warning);
    if (warnings.length > 0) {
      console.error('');
      console.error('='.repeat(60));
      console.error('[cron] SCRAPER HEALTH WARNINGS:');
      for (const r of warnings) {
        console.error(`  ${r.platform}: ${r.warning}`);
      }
      console.error('='.repeat(60));
      console.error('');
    }

    // Step 2: Download images for new listings
    if (allNewIds.length > 0) {
      console.log(`[cron] Step 2: Downloading images for ${allNewIds.length} new listings...`);
      await downloadImagesForNewListings(allNewIds);
    }

    // Step 3: Process images (resize + WebP)
    console.log('[cron] Step 3: Processing images...');
    for (const id of allNewIds) {
      try {
        await processListingImages(id);
      } catch (err: any) {
        console.warn(`[cron] Image processing failed for listing ${id}: ${err.message}`);
      }
    }

    // Step 4: Analyze unanalyzed listings (up to ANALYSIS_BATCH_SIZE)
    // Only if ANTHROPIC_API_KEY is set
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(`[cron] Step 4: Analyzing listings (batch of ${ANALYSIS_BATCH_SIZE})...`);
      const unanalyzed = await db.select()
        .from(listings)
        .where(eq(listings.status, 'new'))
        .limit(ANALYSIS_BATCH_SIZE);

      let analyzed = 0;
      for (const listing of unanalyzed) {
        try {
          await analyzeListing(listing.id);
          analyzed++;
        } catch (err: any) {
          console.warn(`[cron] Analysis failed for listing ${listing.id}: ${err.message}`);
        }
      }
      console.log(`[cron] Analyzed ${analyzed}/${unanalyzed.length} listings`);

      // Step 5: Calculate pricing for analyzed but unpriced listings
      console.log('[cron] Step 5: Calculating prices...');
      const unpriced = await db.select()
        .from(listings)
        .where(isNull(listings.dealScore))
        .limit(ANALYSIS_BATCH_SIZE);

      let priced = 0;
      for (const listing of unpriced) {
        if (!listing.furnitureType) continue; // Skip unanalyzed
        try {
          await calculatePricing(listing.id);
          priced++;
        } catch (err: any) {
          console.warn(`[cron] Pricing failed for listing ${listing.id}: ${err.message}`);
        }
      }
      console.log(`[cron] Priced ${priced} listings`);
    } else {
      console.log('[cron] Step 4: Skipping analysis (ANTHROPIC_API_KEY not set)');
    }

    // Step 6: Clean up orphaned images
    console.log('[cron] Step 6: Cleaning up orphaned images...');
    const cleanup = await cleanupOrphanedImages();
    if (cleanup.filesDeleted > 0) {
      console.log(`[cron] Cleaned ${cleanup.filesDeleted} files (${(cleanup.bytesFreed / 1024 / 1024).toFixed(1)} MB) from ${cleanup.listingsCleaned} listings`);
    }
  } catch (err: any) {
    console.error('[cron] Fatal error:', err);
  } finally {
    await closeBrowser();
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[cron] Run complete in ${elapsed}s`);
  }
}

main().catch(console.error);
