import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { listings, listingImages, projects, conceptRenders } from '../db/schema.js';
import { sql, and, lt, isNotNull, notInArray, isNull, eq } from 'drizzle-orm';
import { IMAGES_DIR } from '../lib/paths.js';
import { config } from '../lib/config.js';
import { agentConfig } from '../agents/config.js';
import logger from '../lib/logger.js';

export interface CleanupResult {
  filesDeleted: number;
  bytesFreed: number;
  listingsCleaned: number;
}

/**
 * Delete image files for listings older than the retention window
 * that were never promoted to a project. DB rows are preserved
 * (paths nulled, status set to 'cleaned') so dedup still works.
 */
export async function cleanupOrphanedImages(): Promise<CleanupResult> {
  const { retentionDays } = config.images;
  const userCutoff = sql`CURRENT_TIMESTAMP - INTERVAL '${sql.raw(String(retentionDays))} days'`;
  const agentCutoff = sql`CURRENT_TIMESTAMP - INTERVAL '${sql.raw(String(agentConfig.agentImageRetentionDays))} days'`;

  // Find listing IDs that have an associated project — these are protected
  const projectListingIds = db
    .select({ listingId: projects.listingId })
    .from(projects);

  // Find old listings without projects that still have image files on disk
  // Agent listings (userId IS NULL) use shorter retention
  // Dismissed agent listings are cleaned immediately
  const staleImages = await db
    .select({
      imageId: listingImages.id,
      listingId: listingImages.listingId,
      localPathOriginal: listingImages.localPathOriginal,
      localPathResized: listingImages.localPathResized,
      fileSizeBytes: listingImages.fileSizeBytes,
    })
    .from(listingImages)
    .innerJoin(listings, sql`${listingImages.listingId} = ${listings.id}`)
    .where(
      and(
        notInArray(listings.id, projectListingIds),
        sql`(${listingImages.localPathOriginal} IS NOT NULL OR ${listingImages.localPathResized} IS NOT NULL)`,
        sql`(
          (${listings.userId} IS NOT NULL AND ${listings.scrapedAt} < ${userCutoff})
          OR (${listings.userId} IS NULL AND ${listings.scrapedAt} < ${agentCutoff})
          OR (${listings.userId} IS NULL AND ${listings.status} IN ('dismissed', 'removed'))
        )`,
      ),
    )
;

  // Also clean up concept render images for dismissed or stale agent listings
  const staleConceptPaths = await db
    .select({ localPath: conceptRenders.localPath })
    .from(conceptRenders)
    .innerJoin(listings, sql`${conceptRenders.listingId} = ${listings.id}`)
    .where(
      and(
        notInArray(listings.id, projectListingIds),
        isNotNull(conceptRenders.localPath),
        sql`(
          (${listings.userId} IS NULL AND ${listings.scrapedAt} < ${agentCutoff})
          OR (${listings.userId} IS NULL AND ${listings.status} IN ('dismissed', 'removed'))
        )`,
      ),
    )
;

  for (const concept of staleConceptPaths) {
    if (concept.localPath) {
      try { fs.unlinkSync(concept.localPath); } catch {}
    }
  }

  if (staleImages.length === 0) {
    logger.info('No orphaned images to clean up');
    return { filesDeleted: 0, bytesFreed: 0, listingsCleaned: 0 };
  }

  let filesDeleted = 0;
  let bytesFreed = 0;
  const cleanedListingIds = new Set<number>();

  for (const img of staleImages) {
    // Delete original file
    if (img.localPathOriginal) {
      const fullPath = path.join(IMAGES_DIR, img.localPathOriginal);
      try {
        const stat = fs.statSync(fullPath);
        fs.unlinkSync(fullPath);
        bytesFreed += stat.size;
        filesDeleted++;
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.warn({ path: fullPath, err: err.message }, 'Failed to delete original image');
        }
      }
    }

    // Delete resized file
    if (img.localPathResized) {
      const fullPath = path.join(IMAGES_DIR, img.localPathResized);
      try {
        const stat = fs.statSync(fullPath);
        fs.unlinkSync(fullPath);
        bytesFreed += stat.size;
        filesDeleted++;
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.warn({ path: fullPath, err: err.message }, 'Failed to delete resized image');
        }
      }
    }

    // Null out paths, mark as cleaned
    await db.update(listingImages)
      .set({
        localPathOriginal: null,
        localPathResized: null,
        downloadStatus: 'cleaned',
      })
      .where(sql`${listingImages.id} = ${img.imageId}`)
;

    cleanedListingIds.add(img.listingId);
  }

  // Try to remove empty listing directories
  for (const listingId of cleanedListingIds) {
    for (const subdir of ['originals', 'resized']) {
      // Listing images are stored as {subdir}/{platform}/{listingId}/
      // We don't know the platform here, so scan both subdirs
      const base = path.join(IMAGES_DIR, subdir);
      if (!fs.existsSync(base)) continue;
      for (const platform of fs.readdirSync(base)) {
        const dir = path.join(base, platform, String(listingId));
        try {
          const entries = fs.readdirSync(dir);
          if (entries.length === 0) {
            fs.rmdirSync(dir);
          }
        } catch {
          // Directory doesn't exist or not empty — fine
        }
      }
    }
  }

  const mb = (bytesFreed / 1024 / 1024).toFixed(1);
  logger.info(
    { filesDeleted, bytesFreed, mbFreed: mb, listingsCleaned: cleanedListingIds.size },
    `Image cleanup complete: deleted ${filesDeleted} files, freed ${mb} MB across ${cleanedListingIds.size} listings`,
  );

  return {
    filesDeleted,
    bytesFreed,
    listingsCleaned: cleanedListingIds.size,
  };
}
