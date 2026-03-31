#!/usr/bin/env tsx
/**
 * Standalone image cleanup script. Deletes image files for listings
 * older than the retention window that were never promoted to a project.
 *
 * Usage:
 *   npm run cleanup:images
 *   npx tsx scripts/cleanup-images.ts
 */

import { cleanupOrphanedImages } from '../server/images/cleanup.js';

async function main() {
  console.log('Running image cleanup...');
  const result = await cleanupOrphanedImages();

  if (result.filesDeleted === 0) {
    console.log('No orphaned images to clean up.');
  } else {
    const mb = (result.bytesFreed / 1024 / 1024).toFixed(1);
    console.log(`Cleaned ${result.filesDeleted} files (${mb} MB) from ${result.listingsCleaned} listings.`);
  }
}

main().catch((err) => {
  console.error('Image cleanup failed:', err);
  process.exit(1);
});
