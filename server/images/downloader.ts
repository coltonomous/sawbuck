import fs from 'fs/promises';
import path from 'path';
import { db } from '../db/index.js';
import { listingImages, listings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { IMAGES_DIR } from '../lib/paths.js';
import { config } from '../lib/config.js';
import logger from '../lib/logger.js';

const REFERERS: Record<string, string> = {
  craigslist: 'https://craigslist.org/',
  offerup: 'https://offerup.com/',
};

function getExtFromUrl(url: string): string {
  const match = url.match(/\.(jpe?g|png|webp|gif)/i);
  return match ? match[1].toLowerCase() : 'jpg';
}

function validateImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function downloadListingImages(listingId: number): Promise<number> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).then(r => r[0]);
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  const images = await db.select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId));

  const pendingImages = images.filter((img) => img.downloadStatus === 'pending');
  if (pendingImages.length === 0) return 0;

  // Create directory for this listing
  const originalDir = path.join(IMAGES_DIR, 'originals', listing.platform, String(listingId));
  await fs.mkdir(originalDir, { recursive: true });

  let downloaded = 0;
  for (let i = 0; i < pendingImages.length; i++) {
    const img = pendingImages[i];
    try {
      if (!validateImageUrl(img.sourceUrl)) {
        logger.warn({ url: img.sourceUrl }, 'Invalid image URL');
        await db.update(listingImages).set({
          downloadStatus: 'failed',
        }).where(eq(listingImages.id, img.id));
        continue;
      }

      const response = await fetch(img.sourceUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': REFERERS[listing.platform] || '',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(config.images.downloadTimeoutMs),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // Check Content-Length before downloading full body
      const contentLength = parseInt(response.headers.get('content-length') || '0');
      if (contentLength > config.images.maxSizeBytes) {
        throw new Error(`Image too large: ${contentLength} bytes (max ${config.images.maxSizeBytes})`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Double-check actual size (Content-Length can be missing/wrong)
      if (buffer.length > config.images.maxSizeBytes) {
        throw new Error(`Downloaded image too large: ${buffer.length} bytes`);
      }
      const ext = getExtFromUrl(img.sourceUrl);
      const filename = `${i}.${ext}`;
      const filePath = path.join(originalDir, filename);
      const relativePath = path.join('originals', listing.platform, String(listingId), filename);

      await fs.writeFile(filePath, buffer);

      await db.update(listingImages).set({
        localPathOriginal: relativePath,
        downloadStatus: 'downloaded',
        fileSizeBytes: buffer.length,
      }).where(eq(listingImages.id, img.id));

      downloaded++;
    } catch (err: any) {
      logger.warn({ url: img.sourceUrl, err: err.message }, 'Failed to download image');
      await db.update(listingImages).set({
        downloadStatus: 'failed',
      }).where(eq(listingImages.id, img.id));
    }
  }

  return downloaded;
}

export async function downloadImagesForNewListings(listingIds: number[]): Promise<number> {
  let total = 0;
  for (const id of listingIds) {
    try {
      const count = await downloadListingImages(id);
      total += count;
    } catch (err: any) {
      logger.error({ listingId: id, err: err.message }, 'Error downloading images for listing');
    }
  }
  logger.info({ total, listingCount: listingIds.length }, 'Image downloads complete');
  return total;
}
