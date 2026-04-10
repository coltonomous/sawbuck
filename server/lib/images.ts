import { db } from '../db/index.js';
import { listingImages } from '../db/schema.js';
import { eq, inArray, sql } from 'drizzle-orm';

/** Returns the best available path for a listing's primary image, or null. */
export async function getPrimaryImagePath(listingId: number): Promise<string | null> {
  const img = await db.select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .limit(1)
    .get();
  return img ? (img.localPathResized || img.localPathOriginal || img.sourceUrl) : null;
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
    .all();

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
