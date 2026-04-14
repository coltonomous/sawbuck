import { db } from '../db/index.js';
import { listingImages } from '../db/schema.js';
import { eq, inArray, sql } from 'drizzle-orm';
import { IMAGES_DIR } from './paths.js';
import path from 'path';
import fs from 'fs/promises';

/** Returns the best available path for a listing's primary image, or null. */
export async function getPrimaryImagePath(listingId: number): Promise<string | null> {
  const img = await db.select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .limit(1)
    .then(r => r[0]);
  return img ? (img.localPathResized || img.localPathOriginal || img.sourceUrl) : null;
}

/**
 * Upload a listing's primary image to fal.ai storage and return the URL.
 * Returns null if no local image exists. Falls back to sourceUrl if available.
 */
export async function getListingImageUrlForFal(listingId: number): Promise<string | null> {
  const img = await db.select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .limit(1)
    .then(r => r[0]);
  if (!img) return null;

  // Prefer local file (upload to fal storage), fall back to sourceUrl
  const localRelPath = img.localPathResized || img.localPathOriginal;
  if (localRelPath) {
    const absPath = path.join(IMAGES_DIR, localRelPath);
    try {
      const buffer = await fs.readFile(absPath);
      const ext = path.extname(localRelPath).toLowerCase();
      const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
      const mime = mimeMap[ext] || 'image/jpeg';
      const { fal } = await import('@fal-ai/client');
      const file = new File([buffer], `listing_${listingId}${ext}`, { type: mime });
      const url = await fal.storage.upload(file);
      return url;
    } catch {
      // Local file missing or upload failed — try sourceUrl
    }
  }

  // sourceUrl is the original remote URL (may be expired for some platforms)
  return img.sourceUrl || null;
}

/** Batch-load primary image paths for multiple listings in a single query. */
export async function getPrimaryImagePaths(listingIds: number[]): Promise<Map<number, string>> {
  if (listingIds.length === 0) return new Map();

  // Use a subquery to get the first image per listing (mimics DISTINCT ON)
  const rows = await db.select({
    listingId: listingImages.listingId,
    localPathResized: listingImages.localPathResized,
    localPathOriginal: listingImages.localPathOriginal,
    sourceUrl: listingImages.sourceUrl,
  })
    .from(listingImages)
    .where(inArray(listingImages.listingId, listingIds))
    .orderBy(listingImages.listingId, listingImages.id)
    ;

  const map = new Map<number, string>();
  for (const row of rows) {
    // First row per listingId wins (ordered by id)
    if (!map.has(row.listingId)) {
      const path = row.localPathResized || row.localPathOriginal || row.sourceUrl;
      map.set(row.listingId, path);
    }
  }
  return map;
}
