import { db } from '../db/index.js';
import { listingImages } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/** Returns the best available path for a listing's primary image, or null. */
export async function getPrimaryImagePath(listingId: number): Promise<string | null> {
  const img = await db.select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .limit(1)
    .get();
  return img ? (img.localPathResized || img.localPathOriginal || img.sourceUrl) : null;
}
